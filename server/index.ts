import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { initDatabase } from './db/database.ts';
import apiRouter from './routes/api.ts';

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Database
initDatabase();

// High Performance Middleware
app.use(compression());
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', apiRouter);

// Serve built frontend if dist exists (Production mode)
const distPath = path.resolve(import.meta.dirname, '../dist');
if (fs.existsSync(distPath)) {
  // Cache static assets (CSS, JS, images) for 1 day for instant load
  app.use(express.static(distPath, {
    maxAge: '1d',
    etag: true,
  }));

  // Fallback for SPA routing in Express 5
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const server = app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` Chhath Puja Samiti Backend API Server Running `);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` Database: SQLite (server/data/donations.db)   `);
  console.log(` API Endpoint: http://localhost:${PORT}/api   `);
  console.log(`===============================================`);

  // Automatic Keep-Alive Mechanism to prevent Render free-tier sleep
  const liveUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
  if (liveUrl) {
    console.log(`[Keep-Alive] Configured for ${liveUrl}. Pinging every 10 minutes.`);
    const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes (Render sleeps after 15 mins)
    setInterval(async () => {
      try {
        const pingRes = await fetch(`${liveUrl}/api/health`);
        if (pingRes.ok) {
          console.log(`[Keep-Alive] Pinged ${liveUrl}/api/health successfully at ${new Date().toLocaleTimeString()}`);
        }
      } catch (err: any) {
        console.warn(`[Keep-Alive] Ping attempt failed:`, err?.message || err);
      }
    }, PING_INTERVAL);
  }
});

export default app;
