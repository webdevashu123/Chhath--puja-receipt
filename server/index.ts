import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { initDatabase } from './db/database.ts';
import apiRouter from './routes/api.ts';

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Database & Seeds
initDatabase();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', apiRouter);

// Serve built frontend if dist exists (Production mode)
const distPath = path.resolve(import.meta.dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
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
});

export default app;
