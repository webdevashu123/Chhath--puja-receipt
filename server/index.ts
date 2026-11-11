import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

import db, { initDatabase } from './db/database.ts';
import apiRouter from './routes/api.ts';
import { apiRateLimiter } from './middleware/auth.ts';
import { initBackupScheduler } from './services/backupService.ts';
import { getReceiptPath, saveReceiptPDF } from './services/pdfService.ts';

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Database & Background Schedulers
initDatabase();
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

// Apply rate limiter to /api
app.use('/api', apiRateLimiter);

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

    const targetPdfPath = getReceiptPath(donation.billNo);

    // Regenerate if file missing on disk
    if (!fs.existsSync(targetPdfPath)) {
      console.log(`[Public Share] PDF missing for bill #${donation.billNo}. Regenerating...`);
      await saveReceiptPDF({
        billNo: donation.billNo,
        donorName: donation.donorName,
        phone: donation.phone,
        amount: donation.amount,
        paymentMode: donation.paymentMode,
        note: donation.note,
        date: donation.createdAt,
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt_${donation.billNo}.pdf"`);
    fs.createReadStream(targetPdfPath).pipe(res);
  } catch (error) {
    console.error('[Public Share Error]:', error);
    res.status(500).send('Error loading receipt');
  }
});

// Serve frontend build from ../dist if available
const distPath = path.resolve(process.cwd(), 'dist');
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
