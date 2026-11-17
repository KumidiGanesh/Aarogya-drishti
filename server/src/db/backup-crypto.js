const { createCipheriv, createDecipheriv, scryptSync } = require('node:crypto');
const { Transform } = require('node:stream');

const MAGIC = Buffer.from('AAROGYA1');
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + SALT_LENGTH + IV_LENGTH;

function deriveBackupKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32);
}

function createEncryptStream(key, iv) {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        callback(null, cipher.update(chunk));
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        this.push(cipher.final());
        this.push(cipher.getAuthTag());
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
}

function createDecryptStream(key, iv, tag) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher;
}

module.exports = {
  MAGIC,
  SALT_LENGTH,
  IV_LENGTH,
  TAG_LENGTH,
  HEADER_LENGTH,
  deriveBackupKey,
  createEncryptStream,
  createDecryptStream,
};
