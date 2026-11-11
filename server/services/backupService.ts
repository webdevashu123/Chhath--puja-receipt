import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import db, { dbPath } from '../db/database.ts';

const BACKUP_DIR = path.resolve(import.meta.dirname, '../../data/backups');
const MAX_BACKUPS = 14;

export async function performBackup(): Promise<string | null> {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    if (!fs.existsSync(dbPath)) {
      console.warn('[Backup] Database file does not exist yet. Skipping backup.');
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `app-${timestamp}.db`;
    const targetPath = path.join(BACKUP_DIR, backupFileName);

    // Use better-sqlite3 live backup API for zero-lock consistent snapshot
    await db.backup(targetPath);
    console.log(`[Backup] Successfully backed up database to: ${backupFileName}`);

    // Prune older backups keeping last 14
    pruneBackups();
    return targetPath;
  } catch (error) {
    console.error('[Backup] Backup failed:', error);
    return null;
  }
}

function pruneBackups(): void {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('app-') && f.endsWith('.db'))
      .map((f) => {
        const fullPath = path.join(BACKUP_DIR, f);
        return {
          name: f,
          path: fullPath,
          time: fs.statSync(fullPath).mtimeMs,
        };
      })
      .sort((a, b) => b.time - a.time);

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      for (const item of toDelete) {
        fs.unlinkSync(item.path);
        console.log(`[Backup Prune] Removed older backup: ${item.name}`);
      }
    }
  } catch (err) {
    console.error('[Backup Prune] Failed to prune old backups:', err);
  }
}

export function initBackupScheduler(): void {
  // Run daily at midnight (00:00)
  cron.schedule('0 0 * * *', () => {
    console.log('[Backup Scheduler] Triggering daily midnight database backup...');
    performBackup().catch((e) => console.error('[Backup Scheduler Error]:', e));
  });

  console.log('[Backup Scheduler] Initialized daily automated backup (retaining last 14).');
}
