import Database from 'better-sqlite3';
import { GridFSBucket, type Db } from 'mongodb';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';

const MIGRATION_ID = 'sqliteSnapshotToNativeMongoV1';

function asDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value).trim().replace(' ', 'T');
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function upsertRows(
  database: Db,
  collectionName: string,
  key: string,
  rows: Record<string, any>[],
): Promise<void> {
  const collection = database.collection(collectionName);
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500);
    if (!batch.length) continue;
    await collection.bulkWrite(batch.map((row) => ({
      updateOne: {
        filter: { [key]: row[key] },
        update: { $set: row },
        upsert: true,
      },
    })), { ordered: false });
  }
}

/** One-time import of the prior GridFS SQLite snapshot into normal MongoDB collections. */
export async function migrateLegacySqliteSnapshot(database: Db): Promise<void> {
  const migrations = database.collection<any>('appMigrations');
  if (await migrations.findOne({ _id: MIGRATION_ID })) return;

  const files = database.collection<any>('sqliteSnapshots.files');
  const latest = await files.find({}).sort({ uploadDate: -1 }).limit(1).next();
  if (!latest) {
    await migrations.insertOne({ _id: MIGRATION_ID, completedAt: new Date(), source: 'no-legacy-snapshot' });
    console.log('[Database] No legacy SQLite snapshot found; starting with native MongoDB collections.');
    return;
  }

  const tempPath = path.join(os.tmpdir(), `legacy-app-${process.pid}-${Date.now()}.db`);
  const bucket = new GridFSBucket(database, { bucketName: 'sqliteSnapshots' });
  await pipeline(bucket.openDownloadStream(latest._id), fs.createWriteStream(tempPath));

  try {
    const legacy = new Database(tempPath, { readonly: true, fileMustExist: true });
    try {
      const tableNames = new Set(
        (legacy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
          .map((table) => table.name),
      );
      const readTable = (name: string): Record<string, any>[] =>
        tableNames.has(name) ? legacy.prepare(`SELECT * FROM ${name}`).all() as Record<string, any>[] : [];

      const donors = readTable('donors').map((row) => ({
        ...row,
        id: Number(row.id),
        name: String(row.name || ''),
        name_normalized: String(row.name_normalized || String(row.name || '').toLowerCase()),
        phone: String(row.phone || ''),
        address: String(row.address || ''),
        total_donated: Number(row.total_donated || 0),
        donation_count: Number(row.donation_count || 0),
        created_at: asDate(row.created_at) || new Date(),
        updated_at: asDate(row.updated_at) || asDate(row.created_at) || new Date(),
      }));
      const phoneByDonorId = new Map(donors.map((donor) => [donor.id, donor.phone]));
      const donations = readTable('donations').map((row) => ({
        ...row,
        id: Number(row.id),
        donor_id: Number(row.donor_id),
        name_on_receipt: String(row.name_on_receipt || row.name || ''),
        bill_no: String(row.bill_no || `legacy-${row.id}`),
        amount: Number(row.amount || 0),
        payment_mode: String(row.payment_mode || row.mode || 'Cash'),
        note: String(row.note || ''),
        created_at: asDate(row.created_at) || new Date(),
        deleted_at: asDate(row.deleted_at),
        share_token: row.share_token ? String(row.share_token) : crypto.randomBytes(16).toString('hex'),
        client_id: row.client_id || null,
        phone: String(row.phone || phoneByDonorId.get(Number(row.donor_id)) || ''),
      }));

      await upsertRows(database, 'donors', 'id', donors);
      await upsertRows(database, 'donations', 'id', donations);

      const settings = readTable('settings').map((row) => ({
        key: String(row.key),
        value: String(row.value ?? ''),
        description: row.description ?? null,
        updated_at: asDate(row.updated_at) || new Date(),
      }));
      await upsertRows(database, 'settings', 'key', settings);

      const auditLogs = readTable('audit_logs').map((row) => ({
        ...row,
        ...(row.id !== undefined ? { id: Number(row.id) } : {}),
        created_at: asDate(row.created_at) || new Date(),
      }));
      if (auditLogs.length) await upsertRows(database, 'audit_logs', 'id', auditLogs);

      const reconciliations = readTable('reconciliations').map((row) => ({
        ...row,
        id: Number(row.id),
        created_at: asDate(row.created_at) || new Date(),
      }));
      if (reconciliations.length) await upsertRows(database, 'reconciliations', 'id', reconciliations);

      const oldCounters = readTable('counters');
      const counters = database.collection<any>('counters');
      for (const row of oldCounters) {
        await counters.updateOne(
          { _id: String(row.name) },
          { $max: { value: Number(row.value || 0) } },
          { upsert: true },
        );
      }
      const maxDonationId = donations.reduce((max, row) => Math.max(max, row.id), 0);
      const maxDonorId = donors.reduce((max, row) => Math.max(max, row.id), 0);
      const maxBillNo = donations.reduce((max, row) => Math.max(max, Number(row.bill_no) || 0), 1000);
      await counters.updateOne({ _id: 'bill_no' }, { $max: { value: maxBillNo } }, { upsert: true });
      await counters.updateOne({ _id: 'donation_id' }, { $max: { value: maxDonationId } }, { upsert: true });
      await counters.updateOne({ _id: 'donor_id' }, { $max: { value: maxDonorId } }, { upsert: true });

      await migrations.insertOne({
        _id: MIGRATION_ID,
        completedAt: new Date(),
        sourceFileId: latest._id,
        donorCount: donors.length,
        donationCount: donations.length,
      });
      console.log(`[Database] Imported legacy SQLite snapshot into native MongoDB collections (${donors.length} donors, ${donations.length} donations).`);
    } finally {
      legacy.close();
    }
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}
