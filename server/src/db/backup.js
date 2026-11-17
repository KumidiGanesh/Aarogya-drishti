require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { getDb, closeMongo } = require('./mongo');
const { MAGIC, SALT_LENGTH, IV_LENGTH, deriveBackupKey, createEncryptStream } = require('./backup-crypto');
const { serializeRecord } = require('./backup-format');

async function* snapshotLines(db) {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  yield serializeRecord({ format: 'aarogya-mongodb-jsonl-v1', database: db.databaseName, collections: collections.map(({ name }) => name) });
  for (const { name } of collections) {
    const cursor = db.collection(name).find({});
    for await (const document of cursor) {
      yield serializeRecord({ collection: name, document });
    }
  }
}

async function run() {
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase || passphrase.length < 16) {
    throw new Error('BACKUP_PASSPHRASE must contain at least 16 characters');
  }
  const outputDirectory = path.resolve(process.env.BACKUP_DIR || './backups');
  await fsp.mkdir(outputDirectory, { recursive: true });

  const db = await getDb();
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  const outputPath = path.join(outputDirectory, `aarogya-${timestamp}.dump.aesgcm`);
  const temporaryPath = `${outputPath}.partial`;
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveBackupKey(passphrase, salt);
  const output = fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 });
  try {
    output.write(Buffer.concat([MAGIC, salt, iv]));
    await pipeline(Readable.from(snapshotLines(db)), createEncryptStream(key, iv), output);
    await fsp.rename(temporaryPath, outputPath);
    console.log(`Encrypted MongoDB backup written: ${outputPath}`);
  } catch (error) {
    output.destroy();
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

run()
  .catch((error) => {
    console.error(`MongoDB backup failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closeMongo);
