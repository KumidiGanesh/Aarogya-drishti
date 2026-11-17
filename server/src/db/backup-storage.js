require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const {
  MAGIC,
  SALT_LENGTH,
  IV_LENGTH,
  TAG_LENGTH,
  HEADER_LENGTH,
  deriveBackupKey,
  createEncryptStream,
  createDecryptStream,
} = require('./backup-crypto');

function requirePassphrase() {
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase || passphrase.length < 16) {
    throw new Error('BACKUP_PASSPHRASE must contain at least 16 characters');
  }
  return passphrase;
}

function runTar(args, options = {}) {
  const child = spawn('tar', args, { windowsHide: true, ...options });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with status ${code}: ${stderr.trim()}`));
    });
  });
  return { child, result };
}

async function backup(outputDirectory) {
  const passphrase = requirePassphrase();
  const source = path.resolve(process.env.STORAGE_LOCAL_PATH || path.resolve(__dirname, '../../storage/private'));
  const sourceStats = await fsp.stat(source);
  if (!sourceStats.isDirectory()) throw new Error('STORAGE_LOCAL_PATH must be a directory');

  const destination = path.resolve(outputDirectory || process.env.BACKUP_DIR || './backups');
  await fsp.mkdir(destination, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  const outputPath = path.join(destination, `aarogya-${timestamp}.storage.tar.aesgcm`);
  const temporaryPath = `${outputPath}.partial`;
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveBackupKey(passphrase, salt);
  const output = fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 });
  output.write(Buffer.concat([MAGIC, salt, iv]));
  const { child, result } = runTar(['-czf', '-', '-C', source, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    await Promise.all([pipeline(child.stdout, createEncryptStream(key, iv), output), result]);
    await fsp.rename(temporaryPath, outputPath);
    console.log(`Encrypted private-storage snapshot written: ${outputPath}`);
    return outputPath;
  } catch (error) {
    child.kill();
    output.destroy();
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function decryptToTemporaryArchive(backupPath) {
  const passphrase = requirePassphrase();
  const handle = await fsp.open(backupPath, 'r');
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aarogya-storage-restore-'));
  const archivePath = path.join(temporaryDirectory, 'snapshot.tar.gz');
  try {
    const stats = await handle.stat();
    if (stats.size < HEADER_LENGTH + TAG_LENGTH) throw new Error('Storage snapshot is too small');
    const header = Buffer.alloc(HEADER_LENGTH);
    const tag = Buffer.alloc(TAG_LENGTH);
    await handle.read(header, 0, HEADER_LENGTH, 0);
    await handle.read(tag, 0, TAG_LENGTH, stats.size - TAG_LENGTH);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Storage snapshot header is invalid');
    }

    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LENGTH);
    const iv = header.subarray(MAGIC.length + SALT_LENGTH);
    const decipher = createDecryptStream(deriveBackupKey(passphrase, salt), iv, tag);
    await pipeline(
      fs.createReadStream(backupPath, { start: HEADER_LENGTH, end: stats.size - TAG_LENGTH - 1 }),
      decipher,
      fs.createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }),
    );
    return { archivePath, temporaryDirectory };
  } catch (error) {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await handle.close();
  }
}

async function restore(backupPath, targetDirectory) {
  if (!backupPath) throw new Error('Pass the encrypted storage snapshot path');
  const target = path.resolve(targetDirectory || process.env.STORAGE_LOCAL_PATH || path.resolve(__dirname, '../../storage/private'));
  const parent = path.dirname(target);
  await fsp.mkdir(parent, { recursive: true });
  const targetStats = await fsp.lstat(target).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (targetStats?.isSymbolicLink() || targetStats && !targetStats.isDirectory()) {
    throw new Error('Storage restore target must be a real directory');
  }
  if (targetStats && (await fsp.readdir(target)).length) {
    throw new Error('Storage restore target must be empty');
  }

  const { archivePath, temporaryDirectory } = await decryptToTemporaryArchive(path.resolve(backupPath));
  const staging = `${target}.restore-${process.pid}`;
  try {
    await fsp.mkdir(staging, { recursive: false, mode: 0o700 });
    const { result } = runTar(
      ['--no-same-owner', '--no-same-permissions', '-xzf', archivePath, '-C', staging],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    await result;
    if (targetStats) await fsp.rmdir(target);
    await fsp.rename(staging, target);
    console.log(`Private-storage snapshot restored to ${target}`);
  } catch (error) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'backup') return backup(args[0]);
  if (action === 'restore') return restore(args[0], args[1]);
  throw new Error('Usage: node backup-storage.js backup [directory] | restore <snapshot> [empty-target]');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Private-storage backup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { backup, restore };
