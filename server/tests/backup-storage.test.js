const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { backup, restore } = require('../src/db/backup-storage');

describe('encrypted private-storage snapshots', () => {
  const originalPassphrase = process.env.BACKUP_PASSPHRASE;
  const originalStoragePath = process.env.STORAGE_LOCAL_PATH;
  const originalBackupDir = process.env.BACKUP_DIR;
  let temporaryRoot;

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aarogya-backup-test-'));
    process.env.BACKUP_PASSPHRASE = 'synthetic-test-passphrase-at-least-16';
    process.env.STORAGE_LOCAL_PATH = path.join(temporaryRoot, 'source');
    process.env.BACKUP_DIR = path.join(temporaryRoot, 'backups');
    await fs.mkdir(path.join(process.env.STORAGE_LOCAL_PATH, 'referrals'), { recursive: true });
    await fs.writeFile(path.join(process.env.STORAGE_LOCAL_PATH, 'referrals', 'encrypted-object.bin'), Buffer.from([0, 7, 91, 255]));
  });

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    if (originalPassphrase === undefined) delete process.env.BACKUP_PASSPHRASE;
    else process.env.BACKUP_PASSPHRASE = originalPassphrase;
    if (originalStoragePath === undefined) delete process.env.STORAGE_LOCAL_PATH;
    else process.env.STORAGE_LOCAL_PATH = originalStoragePath;
    if (originalBackupDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = originalBackupDir;
  });

  it('restores encrypted objects byte-for-byte into an empty target', async () => {
    const snapshot = await backup();
    const target = path.join(temporaryRoot, 'restored');
    await restore(snapshot, target);
    await expect(fs.readFile(path.join(target, 'referrals', 'encrypted-object.bin')))
      .resolves.toEqual(Buffer.from([0, 7, 91, 255]));
  });

  it('rejects a modified authenticated snapshot without restoring files', async () => {
    const snapshot = await backup();
    const contents = await fs.readFile(snapshot);
    contents[contents.length - 1] ^= 0xff;
    await fs.writeFile(snapshot, contents);
    const target = path.join(temporaryRoot, 'rejected');
    await expect(restore(snapshot, target)).rejects.toThrow();
    await expect(fs.access(target)).rejects.toThrow();
  });
});
