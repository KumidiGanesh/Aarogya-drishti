require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { pipeline } = require('node:stream/promises');
const { getDb, closeMongo, ensureIndexes } = require('./mongo');
const { parseRecord } = require('./backup-format');
const {
  MAGIC,
  SALT_LENGTH,
  TAG_LENGTH,
  HEADER_LENGTH,
  deriveBackupKey,
  createDecryptStream,
} = require('./backup-crypto');

async function* records(filePath) {
  const lines = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (line.trim()) yield parseRecord(line);
  }
}

async function validateSnapshot(filePath) {
  let header;
  for await (const item of records(filePath)) {
    if (!header) {
      if (
        item.format !== 'aarogya-mongodb-jsonl-v1' ||
        typeof item.database !== 'string' ||
        !Array.isArray(item.collections)
      ) {
        throw new Error('MongoDB backup manifest is invalid');
      }
      header = item;
      continue;
    }
    if (
      !header.collections.includes(item.collection) ||
      !item.document ||
      typeof item.document !== 'object' ||
      Array.isArray(item.document)
    ) {
      throw new Error('MongoDB backup record is invalid');
    }
  }
  if (!header) throw new Error('MongoDB backup is empty');
  return header;
}

async function restoreSnapshot(db, filePath) {
  let batch = [];
  let batchCollection;
  for await (const item of records(filePath)) {
    if (item.format) continue;
    if (batchCollection !== item.collection || batch.length >= 500) {
      if (batch.length) await db.collection(batchCollection).insertMany(batch, { ordered: true });
      batch = [];
      batchCollection = item.collection;
    }
    batch.push(item.document);
  }
  if (batch.length) await db.collection(batchCollection).insertMany(batch, { ordered: true });
}

async function run() {
  const backupPath = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('Pass the encrypted backup file path as an argument');
  if (process.env.RESTORE_CONFIRM !== 'replace') {
    throw new Error('Set RESTORE_CONFIRM=replace to confirm that the target MongoDB database will be replaced');
  }
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase || passphrase.length < 16) {
    throw new Error('BACKUP_PASSPHRASE must contain at least 16 characters');
  }
  const stats = await fsp.stat(backupPath);
  if (stats.size < HEADER_LENGTH + TAG_LENGTH) throw new Error('Backup file is too small');
  const handle = await fsp.open(backupPath, 'r');
  const temporaryPath = path.join(os.tmpdir(), `aarogya-restore-${randomUUID()}.jsonl`);
  try {
    const header = Buffer.alloc(HEADER_LENGTH);
    const tag = Buffer.alloc(TAG_LENGTH);
    await handle.read(header, 0, HEADER_LENGTH, 0);
    await handle.read(tag, 0, TAG_LENGTH, stats.size - TAG_LENGTH);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Backup file header is invalid');
    }
    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LENGTH);
    const iv = header.subarray(MAGIC.length + SALT_LENGTH);
    await pipeline(
      fs.createReadStream(backupPath, { start: HEADER_LENGTH, end: stats.size - TAG_LENGTH - 1 }),
      createDecryptStream(deriveBackupKey(passphrase, salt), iv, tag),
      fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }),
    );
    const manifest = await validateSnapshot(temporaryPath);
    const db = await getDb();
    if (manifest.database !== db.databaseName) {
      throw new Error(`Backup database "${manifest.database}" does not match configured database "${db.databaseName}"`);
    }
    await db.dropDatabase();
    await restoreSnapshot(db, temporaryPath);
    await ensureIndexes(db);
    console.log(`Encrypted MongoDB backup restored to ${db.databaseName}.`);
  } finally {
    await handle.close();
    await fsp.rm(temporaryPath, { force: true });
  }
}

run()
  .catch((error) => {
    console.error(`MongoDB restore failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closeMongo);
