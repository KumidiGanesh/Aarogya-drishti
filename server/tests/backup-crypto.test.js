const { randomBytes } = require('node:crypto');
const { Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const {
  deriveBackupKey,
  createEncryptStream,
  createDecryptStream,
} = require('../src/db/backup-crypto');

async function collect(stream) {
  const chunks = [];
  await pipeline(
    stream,
    new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  return Buffer.concat(chunks);
}

describe('authenticated backup encryption', () => {
  it('encrypts and decrypts a stream with AES-256-GCM', async () => {
    const plaintext = Buffer.from('synthetic database backup');
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = deriveBackupKey('test-only backup passphrase', salt);
    const encrypted = await collect(Readable.from([plaintext]).pipe(createEncryptStream(key, iv)));
    const ciphertext = encrypted.subarray(0, -16);
    const tag = encrypted.subarray(-16);
    const decrypted = await collect(
      Readable.from([ciphertext]).pipe(createDecryptStream(key, iv, tag)),
    );
    expect(decrypted).toEqual(plaintext);
  });

  it('rejects a modified ciphertext', async () => {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = deriveBackupKey('test-only backup passphrase', salt);
    const encrypted = await collect(
      Readable.from([Buffer.from('backup payload')]).pipe(createEncryptStream(key, iv)),
    );
    const ciphertext = Buffer.from(encrypted.subarray(0, -16));
    ciphertext[0] ^= 0xff;
    await expect(
      collect(
        Readable.from([ciphertext]).pipe(createDecryptStream(key, iv, encrypted.subarray(-16))),
      ),
    ).rejects.toThrow();
  });
});
