import { MongoClient, GridFSBucket, type Db } from 'mongodb';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE || 'chhath_puja';
let client: MongoClient | undefined;
let mongoDb: Db | undefined;
let bucket: GridFSBucket | undefined;
let snapshotQueue: Promise<void> = Promise.resolve();

async function connectMongo(): Promise<void> {
  if (bucket) return;
  if (!uri) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MONGODB_URI is required in production. Set it in Render Environment.');
    }
    return;
  }

  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  mongoDb = client.db(databaseName);
  bucket = new GridFSBucket(mongoDb, { bucketName: 'sqliteSnapshots' });
  await mongoDb.collection('sqliteSnapshots.files').createIndex({ uploadDate: -1 });
  console.log(`[Database] Connected to MongoDB Atlas database "${databaseName}".`);
}

export async function restoreLatestSnapshot(databasePath: string): Promise<boolean> {
  await connectMongo();
  if (!bucket || !mongoDb) return false;

  const latest = await mongoDb.collection('sqliteSnapshots.files').find({}).sort({ uploadDate: -1 }).limit(1).next();
  if (!latest) {
    console.log('[Database] No Atlas snapshot found; initializing a new SQLite database.');
    return false;
  }

  // Keep the temporary restore file beside the database. Render mounts these
  // paths on different filesystems, where rename(/tmp, dataDir) fails with EXDEV.
  const restorePath = path.join(path.dirname(databasePath), `.app-restore-${process.pid}.db`);
  await pipeline(bucket.openDownloadStream(latest._id), fs.createWriteStream(restorePath));
  for (const suffix of ['-wal', '-shm', '-journal']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  try {
    fs.renameSync(restorePath, databasePath);
  } catch (error) {
    // Windows cannot replace an existing destination with rename; the server
    // hasn't opened SQLite yet, so remove the old file and complete the swap.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'EPERM') {
      throw error;
    }
    fs.rmSync(databasePath, { force: true });
    fs.renameSync(restorePath, databasePath);
  }
  console.log(`[Database] Restored latest Atlas snapshot (${latest.uploadDate?.toISOString?.() || 'date unavailable'}).`);
  return true;
}

export function persistSnapshot(createSnapshot: (targetPath: string) => Promise<void>): Promise<void> {
  if (!bucket) return Promise.resolve();

  snapshotQueue = snapshotQueue.catch(() => undefined).then(async () => {
    const tempPath = path.join(os.tmpdir(), `chhath-snapshot-${process.pid}-${Date.now()}.db`);
    try {
      await createSnapshot(tempPath);
      const upload = bucket!.openUploadStream('app.db', { metadata: { source: 'sqlite', createdAt: new Date() } });
      await pipeline(fs.createReadStream(tempPath), upload);

      const oldFiles = await mongoDb!.collection('sqliteSnapshots.files')
        .find({ _id: { $ne: upload.id } }, { projection: { _id: 1 } })
        .toArray();
      for (const old of oldFiles) await bucket!.delete(old._id);
      console.log('[Database] Persisted SQLite snapshot to MongoDB Atlas.');
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  });

  return snapshotQueue;
}

export async function closeMongo(): Promise<void> {
  await snapshotQueue;
  await client?.close();
}
