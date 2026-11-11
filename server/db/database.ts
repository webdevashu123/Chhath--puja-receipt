import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const dbPath = path.join(dataDir, 'app.db');
const db: DatabaseType = new Database(dbPath);

// Enable WAL mode and foreign keys for high performance and integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS donors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donor_id INTEGER NOT NULL,
      bill_no TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL CHECK(amount > 0),
      payment_mode TEXT NOT NULL CHECK(payment_mode IN ('Cash', 'Online', 'PhonePe', 'GPay', 'Cheque')),
      note TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      pdf_path TEXT,
      share_token TEXT NOT NULL UNIQUE,
      client_id TEXT UNIQUE,
      FOREIGN KEY (donor_id) REFERENCES donors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_donations_donor_id ON donations(donor_id);
    CREATE INDEX IF NOT EXISTS idx_donations_bill_no ON donations(bill_no);
    CREATE INDEX IF NOT EXISTS idx_donations_deleted_at ON donations(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations(created_at);
    CREATE INDEX IF NOT EXISTS idx_donations_share_token ON donations(share_token);
    CREATE INDEX IF NOT EXISTS idx_donations_client_id ON donations(client_id);
    CREATE INDEX IF NOT EXISTS idx_donors_phone ON donors(phone);
    CREATE INDEX IF NOT EXISTS idx_donors_name ON donors(name);
  `);

  // Initialize bill_no counter sequence starting at 1000, so first bill is 1001
  const initCounter = db.prepare(`
    INSERT OR IGNORE INTO counters (name, value) VALUES ('bill_no', 1000)
  `);
  initCounter.run();
}

/**
 * Generates sequential bill numbers atomically inside SQLite transaction.
 * Guarantees no two simultaneous requests ever get the same number.
 */
export function getNextBillNo(): number {
  return db.transaction(() => {
    db.prepare(`UPDATE counters SET value = value + 1 WHERE name = 'bill_no'`).run();
    const row = db.prepare(`SELECT value FROM counters WHERE name = 'bill_no'`).get() as { value: number };
    return row.value;
  })();
}

/**
 * Matches donor by phone. If phone exists, reuses donor and updates name only if existing was empty.
 */
export function findOrCreateDonor(phone: string, name: string): { id: number; name: string; phone: string } {
  return db.transaction(() => {
    const existing = db.prepare(`SELECT id, name, phone FROM donors WHERE phone = ?`).get(phone) as { id: number; name: string; phone: string } | undefined;
    if (existing) {
      if ((!existing.name || existing.name.trim() === '') && name.trim()) {
        db.prepare(`UPDATE donors SET name = ? WHERE id = ?`).run(name.trim(), existing.id);
        return { id: existing.id, name: name.trim(), phone: existing.phone };
      }
      return existing;
    }

    const result = db.prepare(`INSERT INTO donors (name, phone) VALUES (?, ?)`).run(name.trim(), phone.trim());
    return {
      id: Number(result.lastInsertRowid),
      name: name.trim(),
      phone: phone.trim(),
    };
  })();
}

export default db;
