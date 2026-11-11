import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.resolve(import.meta.dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const dbPath = path.join(dataDir, 'app.db');
const db: DatabaseType = new Database(dbPath);

// Enable WAL mode and foreign keys for high performance and integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Normalizes English donor name:
 * 1. Trims leading/trailing whitespace
 * 2. Collapses internal consecutive spaces into a single space
 * 3. Formats to Title Case (e.g., "ramesh kumar" -> "Ramesh Kumar")
 * 4. Generates lowercase representation for normalized search
 */
export function normalizeName(rawName: string): { titleCase: string; lowercase: string } {
  const trimmed = rawName.trim().replace(/\s+/g, ' ');
  // Title Case: Capitalize first letter of each word or segment after space, hyphen, period, apostrophe
  const titleCase = trimmed
    .toLowerCase()
    .replace(/(?:^|[\s.'-])[a-z]/g, (char) => char.toUpperCase());

  return {
    titleCase,
    lowercase: titleCase.toLowerCase(),
  };
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS donors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donor_id INTEGER NOT NULL,
      name_on_receipt TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_donors_phone ON donors(phone);
    CREATE INDEX IF NOT EXISTS idx_donors_name_normalized ON donors(name_normalized);
    CREATE INDEX IF NOT EXISTS idx_donations_donor_id ON donations(donor_id);
    CREATE INDEX IF NOT EXISTS idx_donations_bill_no ON donations(bill_no);
    CREATE INDEX IF NOT EXISTS idx_donations_deleted_at ON donations(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations(created_at);
    CREATE INDEX IF NOT EXISTS idx_donations_share_token ON donations(share_token);
    CREATE INDEX IF NOT EXISTS idx_donations_client_id ON donations(client_id);
  `);

  // Initialize sequential counter starting at 1000 so the first bill number generated is 1001
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
 * Matches donor strictly by phone (10 digits, UNIQUE).
 * If phone exists, reuses existing donor record.
 * Stores name used in this transaction as nameOnReceipt so past receipts never mutate.
 */
export function findOrCreateDonor(phone: string, rawName: string): {
  id: number;
  name: string;
  name_normalized: string;
  phone: string;
  nameOnReceipt: string;
} {
  const { titleCase, lowercase } = normalizeName(rawName);

  return db.transaction(() => {
    const existing = db.prepare(`
      SELECT id, name, name_normalized, phone
      FROM donors
      WHERE phone = ?
    `).get(phone) as { id: number; name: string; name_normalized: string; phone: string } | undefined;

    if (existing) {
      // If existing name was empty, populate it with normalized name
      if (!existing.name || existing.name.trim() === '') {
        db.prepare(`UPDATE donors SET name = ?, name_normalized = ? WHERE id = ?`).run(
          titleCase,
          lowercase,
          existing.id
        );
        return {
          id: existing.id,
          name: titleCase,
          name_normalized: lowercase,
          phone: existing.phone,
          nameOnReceipt: titleCase,
        };
      }
      return {
        id: existing.id,
        name: existing.name,
        name_normalized: existing.name_normalized,
        phone: existing.phone,
        nameOnReceipt: titleCase,
      };
    }

    // Insert new donor
    const result = db.prepare(`
      INSERT INTO donors (name, name_normalized, phone)
      VALUES (?, ?, ?)
    `).run(titleCase, lowercase, phone);

    return {
      id: Number(result.lastInsertRowid),
      name: titleCase,
      name_normalized: lowercase,
      phone,
      nameOnReceipt: titleCase,
    };
  })();
}

export default db;
