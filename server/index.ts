import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env') });

import { closeDatabase, connectDatabase, getCollection, type DonationDocument } from './db/database.ts';
import apiRouter from './routes/api.ts';
import { apiRateLimiter } from './middleware/auth.ts';
import { getReceiptPath, saveReceiptPDF, isValidReceiptPDF } from './services/pdfService.ts';

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

// Do not accept traffic until Atlas connects, indexes are ready, and legacy data is migrated.
await connectDatabase();

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

    const donation = await getCollection<DonationDocument>('donations').findOne({ share_token: token });
    const donor = donation ? await getCollection('donors').findOne({ id: donation.donor_id }) : null;

    if (!donation || donation.deleted_at || !donor) {
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

    const language = 'en';
    const targetPdfPath = getReceiptPath(donation.bill_no, language);

    // Regenerate if file missing on disk
    if (!isValidReceiptPDF(targetPdfPath)) {
      fs.rmSync(targetPdfPath, { force: true });
      try {
        console.log(`[Public Share] PDF missing for bill #${donation.bill_no}. Regenerating...`);
        await saveReceiptPDF({
          billNo: donation.bill_no,
          donorName: donation.name_on_receipt,
          phone: donor.phone,
          amount: donation.amount,
          paymentMode: donation.payment_mode,
          note: donation.note,
          date: donation.created_at,
        }, language);
      } catch (genErr) {
        console.error(`[Public Share] PDF generation failed for bill #${donation.bill_no}:`, genErr);
        res.status(503).type('text/plain').send('English PDF generation failed. Please try again shortly.');
        return;
      }
    }

    if (isValidReceiptPDF(targetPdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="receipt_${donation.bill_no}_${language}.pdf"`);
      fs.createReadStream(targetPdfPath).pipe(res);
      return;
    }

    res.status(503).type('text/plain').send('English PDF generation did not produce a valid PDF.');
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
  console.log(` Database: MongoDB Atlas native collections`);
  console.log(` API Endpoint: http://localhost:${PORT}/api`);
  console.log(` Public Receipts: http://localhost:${PORT}/r/:token`);
  console.log(`===============================================`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  });
}

export default app;
