import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env') });

import db, { dbPath, initDatabase, restoredFromAtlas } from './db/database.ts';
import { persistSnapshot } from './db/mongoSnapshot.ts';
import apiRouter from './routes/api.ts';
import { apiRateLimiter } from './middleware/auth.ts';
import { initBackupScheduler } from './services/backupService.ts';
import { getReceiptPath, saveReceiptPDF, renderPrintableReceiptHTML } from './services/pdfService.ts';

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Database & Background Schedulers
initDatabase();
if (!restoredFromAtlas) {
  await persistSnapshot(async (targetPath) => { await db.backup(targetPath); });
}
initBackupScheduler();

// Security & Production Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));

const allowedOrigin = process.env.ORIGIN;
app.use(cors({
  origin: allowedOrigin ? [allowedOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5000'] : true,
  credentials: true,
}));

app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

// Lightweight endpoint for platform health checks and the free-tier wake-up monitor.
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Apply rate limiter to /api
app.use('/api', apiRateLimiter);

// Persist every API write to Atlas before returning success to the client.
// This keeps the existing synchronous SQLite query layer intact while making
// the durable copy live outside Render's ephemeral filesystem.
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }

  const send = res.send.bind(res);
  let responseHandled = false;
  res.send = ((body?: any) => {
    if (responseHandled) return res;
    responseHandled = true;
    persistSnapshot(async (targetPath) => { await db.backup(targetPath); })
      .then(() => send(body))
      .catch((error) => {
        console.error('[Database] Atlas snapshot failed; write response withheld:', error);
        if (!res.headersSent) {
          res.status(503).type('application/json');
          send(JSON.stringify({
            error: 'Database backup failed. Please retry; the change was not confirmed as saved.',
          }));
        } else {
          res.end();
        }
      });
    return res;
  }) as typeof res.send;

  next();
});

// Mount API routes
app.use('/api', apiRouter);

// Public Receipt Share Link (/r/:token) for WhatsApp and direct access
app.get('/r/:token', async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    if (!token) {
      res.status(400).send('Invalid receipt link');
      return;
    }

    const donation = db.prepare(`
      SELECT 
        donations.id,
        donations.bill_no as billNo,
        donations.amount,
        donations.payment_mode as paymentMode,
        donations.note,
        donations.created_at as createdAt,
        donations.deleted_at as deletedAt,
        donors.name as donorName,
        donors.phone
      FROM donations
      JOIN donors ON donations.donor_id = donors.id
      WHERE donations.share_token = ?
    `).get(token) as any;

    if (!donation || donation.deletedAt) {
      res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Receipt Not Found</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #fff8f1; color: #1b2a3a;">
          <h2 style="color: #c2410c;">रसीद उपलब्ध नहीं है / Receipt Not Found</h2>
          <p>यह रसीद मान्य नहीं है या हटा दी गई है। / This receipt link is invalid or has been archived.</p>
        </body>
        </html>
      `);
      return;
    }

    const language = req.query.lang === 'hi' ? 'hi' : 'en';
    const targetPdfPath = getReceiptPath(donation.billNo, language);

    // Regenerate if file missing on disk
    if (!fs.existsSync(targetPdfPath)) {
      try {
        console.log(`[Public Share] PDF missing for bill #${donation.billNo}. Regenerating...`);
        await saveReceiptPDF({
          billNo: donation.billNo,
          donorName: donation.donorName,
          phone: donation.phone,
          amount: donation.amount,
          paymentMode: donation.paymentMode,
          note: donation.note,
          date: donation.createdAt,
        }, language);
      } catch (genErr) {
        console.warn(`[Public Share] PDF render unavailable, serving printable HTML receipt:`, genErr);
      }
    }

    if (fs.existsSync(targetPdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="receipt_${donation.billNo}_${language}.pdf"`);
      fs.createReadStream(targetPdfPath).pipe(res);
      return;
    }

    // Show a readable receipt fallback without launching Chrome's print dialog.
    const html = renderPrintableReceiptHTML({
      billNo: donation.billNo,
      donorName: donation.donorName,
      phone: donation.phone,
      amount: donation.amount,
      paymentMode: donation.paymentMode,
      note: donation.note,
      date: donation.createdAt,
    }, language, false);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('[Public Share Error]:', error);
    res.status(500).send('Error loading receipt');
  }
});

// Serve frontend build from ../dist if available
const distPath = path.resolve(import.meta.dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, {
    maxAge: '1d',
    etag: true,
  }));

  // SPA fallback
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/r/')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Global Error Handler - Never expose stack traces to client
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Unhandled Error]:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` Chhath Puja Samiti Full-Stack Service Running `);
  console.log(` Port: ${PORT}`);
  console.log(` Database: ./data/app.db (WAL Mode)`);
  console.log(` API Endpoint: http://localhost:${PORT}/api`);
  console.log(` Public Receipts: http://localhost:${PORT}/r/:token`);
  console.log(`===============================================`);
});

export default app;
