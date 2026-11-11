import { MongoClient, type Collection, type Db } from 'mongodb';
import path from 'node:path';
import dotenv from 'dotenv';
import { migrateLegacySqliteSnapshot } from './legacyMigration.ts';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

export interface DonorDocument {
  id: number;
  name: string;
  name_normalized: string;
  phone: string;
  address?: string;
  total_donated?: number;
  donation_count?: number;
  created_at: Date | string;
  updated_at?: Date | string;
}

export interface DonationDocument {
  id: number;
  donor_id: number;
  name_on_receipt: string;
  bill_no: string;
  amount: number;
  payment_mode: 'Cash' | 'Online' | 'PhonePe' | 'GPay' | 'Cheque';
  note: string;
  created_at: Date | string;
  deleted_at: Date | string | null;
  pdf_path?: string;
  share_token: string | null;
  client_id?: string | null;
  phone?: string;
}

let client: MongoClient | undefined;
let database: Db | undefined;

export function getDatabase(): Db {
  if (!database) throw new Error('MongoDB has not been connected.');
  return database;
}

export function normalizeName(rawName: string): { titleCase: string; lowercase: string } {
  const trimmed = rawName.trim().replace(/\s+/g, ' ');
  const titleCase = trimmed
    .toLowerCase()
    .replace(/(?:^|[\s.'-])[a-z]/g, (char) => char.toUpperCase());
  return { titleCase, lowercase: titleCase.toLowerCase() };
}

export function getCollection<T extends Record<string, any> = Record<string, any>>(name: string): Collection<T> {
  return getDatabase().collection<T>(name);
}

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required. Set it in Render Environment.');

  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  database = client.db(process.env.MONGODB_DATABASE || 'chhath_puja');

  const donors = getCollection<DonorDocument>('donors');
  const donations = getCollection<DonationDocument>('donations');
  await Promise.all([
    donors.createIndex({ id: 1 }, { unique: true }),
    donors.createIndex({ phone: 1 }, { unique: true }),
    donors.createIndex({ name_normalized: 1 }),
    donations.createIndex({ id: 1 }, { unique: true }),
    donations.createIndex({ bill_no: 1 }, { unique: true }),
    donations.createIndex({ share_token: 1 }, { unique: true, partialFilterExpression: { share_token: { $type: 'string' } } }),
    donations.createIndex({ client_id: 1 }, { unique: true, partialFilterExpression: { client_id: { $type: 'string' } } }),
    donations.createIndex({ donor_id: 1, id: -1 }),
    donations.createIndex({ deleted_at: 1, created_at: -1 }),
  ]);

  await migrateLegacySqliteSnapshot(getDatabase());

  const counters = getCollection<{ _id: string; value: number }>('counters');
  await counters.updateOne({ _id: 'bill_no' }, { $setOnInsert: { value: 1000 } }, { upsert: true });
  await counters.updateOne({ _id: 'donation_id' }, { $setOnInsert: { value: 0 } }, { upsert: true });
  await counters.updateOne({ _id: 'donor_id' }, { $setOnInsert: { value: 0 } }, { upsert: true });

  console.log(`[Database] Connected to MongoDB database "${database.databaseName}"; native collections are ready.`);
}

export async function nextSequence(name: string): Promise<number> {
  const result = await getCollection<{ _id: string; value: number }>('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  if (!result) throw new Error(`Unable to allocate ${name} sequence.`);
  return result.value;
}

export async function closeDatabase(): Promise<void> {
  await client?.close();
  client = undefined;
  database = undefined;
}
