import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.resolve(import.meta.dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'donations.db');
const db: DatabaseType = new Database(dbPath);

// Enable WAL mode and foreign keys for high performance and integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS donors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      address TEXT DEFAULT '',
      total_donated REAL DEFAULT 0,
      donation_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_no TEXT NOT NULL UNIQUE,
      donor_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      mode TEXT NOT NULL CHECK(mode IN ('Cash', 'Online', 'PhonePe', 'GPay', 'Cheque')),
      reference_no TEXT DEFAULT '',
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'verified' CHECK(status IN ('verified', 'pending', 'reconciled', 'cancelled')),
      collector_name TEXT DEFAULT 'A. Prasad',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (donor_id) REFERENCES donors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reconciliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_date TEXT NOT NULL,
      mode_category TEXT NOT NULL CHECK(mode_category IN ('Cash', 'Online', 'All')),
      system_amount REAL NOT NULL,
      physical_or_bank_amount REAL NOT NULL,
      discrepancy REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('matched', 'discrepancy', 'pending')),
      reconciled_by TEXT NOT NULL DEFAULT 'A. Prasad',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      bill_no TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_donations_donor_id ON donations(donor_id);
    CREATE INDEX IF NOT EXISTS idx_donations_mode ON donations(mode);
    CREATE INDEX IF NOT EXISTS idx_donations_timestamp ON donations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_donations_date ON donations(date);
    CREATE INDEX IF NOT EXISTS idx_donations_bill_no ON donations(bill_no);
    CREATE INDEX IF NOT EXISTS idx_donors_phone ON donors(phone);
    CREATE INDEX IF NOT EXISTS idx_donors_name ON donors(name);
  `);

  // Default configuration - Only original settings, 0 mock records
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)
  `);

  insertSetting.run('samiti_name', 'Chhath Puja Samiti', 'Committee Name');
  insertSetting.run('location', 'Yogidih, Dudhari', 'Event Location');
  insertSetting.run('puja_year', '2026', 'Festival Year');
  insertSetting.run('target_goal', '251000', 'Fundraising Target Goal (INR)');
  insertSetting.run('admin_pin', '2026', 'Admin Access PIN');
  insertSetting.run('authorized_signatory', 'A. Prasad', 'Authorized Signatory');
  insertSetting.run('bill_prefix', 'CP-2026-', 'Bill Prefix');
  insertSetting.run('next_bill_number', '1', 'Next Sequential Bill Number');
}

// Function to wipe out all data and reset to 0
export function clearAllData(): void {
  db.transaction(() => {
    db.prepare('DELETE FROM donations').run();
    db.prepare('DELETE FROM donors').run();
    db.prepare('DELETE FROM reconciliations').run();
    db.prepare('DELETE FROM audit_logs').run();
    db.prepare("UPDATE settings SET value = '1', updated_at = CURRENT_TIMESTAMP WHERE key = 'next_bill_number'").run();
    db.prepare(`
      INSERT INTO audit_logs (action, entity_type, details)
      VALUES ('DATABASE_RESET', 'system', 'All donation data cleared. Ready for original records.')
    `).run();
  })();
}

export default db;
