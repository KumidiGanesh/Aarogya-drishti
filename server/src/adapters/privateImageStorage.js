const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');

let s3Client;
let bucketReady;

function encryptionKey() {
  const value = process.env.STORAGE_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';
  if (/^[\da-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  try {
    const key = Buffer.from(value, 'base64');
    if (key.length === 32 && key.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')) {
      return key;
    }
  } catch {
    // The configuration error below is the actionable failure.
  }
  const error = new Error(
    'STORAGE_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters or base64',
  );
  error.status = 500;
  error.code = 'IMAGE_ENCRYPTION_NOT_CONFIGURED';
  throw error;
}

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT,
      region: process.env.STORAGE_REGION || 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY || '',
        secretAccessKey: process.env.STORAGE_SECRET_KEY || '',
      },
    });
  }
  return s3Client;
}

function localRoot() {
  return path.resolve(
    process.env.STORAGE_LOCAL_PATH || path.join(__dirname, '..', '..', 'storage', 'private'),
  );
}

async function ensureBucket() {
  if (process.env.STORAGE_AUTO_CREATE_BUCKET !== 'true') return;
  if (!bucketReady) {
    const client = getS3Client();
    const bucket = process.env.STORAGE_BUCKET;
    bucketReady = client
      .send(new HeadBucketCommand({ Bucket: bucket }))
      .catch(async (error) => {
        if (error.$metadata?.httpStatusCode !== 404 && error.name !== 'NoSuchBucket') {
          throw error;
        }
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      })
      .catch((error) => {
        bucketReady = undefined;
        throw error;
      });
  }
  await bucketReady;
}

function assertStorageKey(key) {
  if (
    typeof key !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
  ) {
    const error = new Error('Stored image key is invalid');
    error.status = 500;
    error.code = 'IMAGE_STORAGE_KEY_INVALID';
    throw error;
  }
}

function encryptionKeyId() {
  return process.env.STORAGE_ENCRYPTION_KEY_ID || 'storage-key-v1';
}

async function putObject(key, encryptedBytes) {
  if ((process.env.STORAGE_DRIVER || 'local') === 's3') {
    await ensureBucket();
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: process.env.STORAGE_BUCKET,
        Key: key,
        Body: encryptedBytes,
        ContentType: 'application/octet-stream',
        ServerSideEncryption: 'AES256',
      }),
    );
    return;
  }

  const root = localRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const destination = path.join(root, `${key}.enc`);
  const temporary = path.join(root, `${key}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, encryptedBytes, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function readObject(key) {
  assertStorageKey(key);
  if ((process.env.STORAGE_DRIVER || 'local') === 's3') {
    const result = await getS3Client().send(
      new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key }),
    );
    return Buffer.from(await result.Body.transformToByteArray());
  }
  return fs.readFile(path.join(localRoot(), `${key}.enc`));
}

async function deleteObject(key) {
  assertStorageKey(key);
  if ((process.env.STORAGE_DRIVER || 'local') === 's3') {
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key }),
    );
    return;
  }
  await fs.rm(path.join(localRoot(), `${key}.enc`), { force: true });
}

async function encryptAndStore(plaintext) {
  const keyBytes = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const storageKey = `${crypto.randomUUID()}`;
  await putObject(storageKey, encrypted);
  return {
    storage_key: storageKey,
    encryption_algorithm: 'aes-256-gcm',
    encryption_key_id: encryptionKeyId(),
    encryption_iv: iv.toString('base64'),
    encryption_auth_tag: cipher.getAuthTag().toString('base64'),
    content_hash: crypto.createHash('sha256').update(plaintext).digest('hex'),
  };
}

async function decryptStoredImage(metadata) {
  if (metadata.encryption_algorithm !== 'aes-256-gcm') {
    const error = new Error('Stored image encryption metadata is not supported');
    error.status = 500;
    error.code = 'IMAGE_ENCRYPTION_METADATA_INVALID';
    throw error;
  }
  if (metadata.encryption_key_id !== encryptionKeyId()) {
    const error = new Error('Stored image encryption key ID does not match the configured key');
    error.status = 500;
    error.code = 'IMAGE_ENCRYPTION_KEY_ID_MISMATCH';
    throw error;
  }
  const iv = Buffer.from(metadata.encryption_iv || '', 'base64');
  const authTag = Buffer.from(metadata.encryption_auth_tag || '', 'base64');
  if (iv.length !== 12 || authTag.length !== 16) {
    const error = new Error('Stored image encryption metadata is malformed');
    error.status = 500;
    error.code = 'IMAGE_ENCRYPTION_METADATA_INVALID';
    throw error;
  }
  const keyBytes = encryptionKey();
  const encrypted = await readObject(metadata.storage_key);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    keyBytes,
    iv,
  );
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const contentHash = crypto.createHash('sha256').update(plaintext).digest('hex');
  if (contentHash !== metadata.content_hash) {
    const error = new Error('Stored image integrity verification failed');
    error.status = 500;
    error.code = 'IMAGE_INTEGRITY_FAILURE';
    throw error;
  }
  return plaintext;
}

function resetS3ClientForTests() {
  s3Client = undefined;
  bucketReady = undefined;
}

module.exports = {
  encryptAndStore,
  decryptStoredImage,
  deleteObject,
  encryptionKey,
  resetS3ClientForTests,
};
