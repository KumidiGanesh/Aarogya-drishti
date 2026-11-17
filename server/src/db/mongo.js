require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const { MongoClient } = require('mongodb');
const logger = require('../utils/logger');
const errorMessage = require('../utils/errorMessage');
const os = require('node:os');

const connectionString =
  process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/aarogya_drishti';
const databaseName = process.env.MONGODB_DATABASE || 'aarogya_drishti';
const client = new MongoClient(connectionString, {
  appName: 'aarogya-drishti-api',
  serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 5000,
  maxPoolSize: Number(process.env.MONGO_POOL_MAX) || 10,
  runtimeAdapters: { os },
});

let connectionPromise;

const indexes = {
  users: [
    { key: { id: 1 }, options: { unique: true } },
    {
      key: { email: 1 },
      options: { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
    },
    {
      key: { mobile: 1 },
      options: { unique: true, partialFilterExpression: { mobile: { $type: 'string' } } },
    },
    {
      key: { username: 1 },
      options: { unique: true, partialFilterExpression: { username: { $type: 'string' } } },
    },
    {
      key: { admin_id: 1 },
      options: { unique: true, partialFilterExpression: { admin_id: { $type: 'string' } } },
    },
    { key: { role: 1, is_active: 1 } },
  ],
  roles: [{ key: { name: 1 }, options: { unique: true } }],
  permissions: [{ key: { code: 1 }, options: { unique: true } }],
  refresh_tokens: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { token_hash: 1 }, options: { unique: true } },
    { key: { family_id: 1 } },
    { key: { user_id: 1, revoked_at: 1 } },
  ],
  otp_verifications: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { target: 1, purpose: 1, created_at: -1 } },
    { key: { purge_at: 1 }, options: { expireAfterSeconds: 0 } },
  ],
  otp_grants: [
    { key: { token_hash: 1 }, options: { unique: true } },
    { key: { expires_at: 1 }, options: { expireAfterSeconds: 0 } },
  ],
  patients: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { patient_code: 1 }, options: { unique: true } },
    { key: { client_uuid: 1 }, options: { unique: true } },
    { key: { mobile: 1, deleted_at: 1, is_active: 1 } },
    { key: { registered_by: 1, created_at: -1 } },
  ],
  audit_logs: [{ key: { user_id: 1, created_at: -1 } }, { key: { action: 1, created_at: -1 } }],
  notifications: [{ key: { user_id: 1, is_read: 1, created_at: -1 } }],
  user_presence: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { user_id: 1, expires_at: 1 } },
    { key: { expires_at: 1 }, options: { expireAfterSeconds: 0 } },
  ],
  appointments: [
    { key: { patient_id: 1, scheduled_at: -1 } },
    { key: { doctor_id: 1, scheduled_at: 1 } },
  ],
  consultations: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { appointment_id: 1, created_at: -1 } },
    { key: { patient_id: 1, created_at: -1 } },
    { key: { doctor_id: 1, created_at: -1 } },
  ],
  consultation_calls: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { consultation_id: 1, created_at: -1 } },
    { key: { participants_user_ids: 1, created_at: -1 } },
    {
      key: { participants_user_ids: 1 },
      options: {
        name: 'idx_consultation_calls_one_active_call_per_participant',
        unique: true,
        partialFilterExpression: { status: { $in: ['ringing', 'accepted'] } },
      },
    },
  ],
  consultation_notes: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { consultation_id: 1, created_at: 1 } },
  ],
  oral_screenings: [{ key: { patient_id: 1, created_at: -1 } }],
  ai_screening_results: [{ key: { screening_id: 1, created_at: -1 } }],
  screening_doctor_requests: [
    { key: { screening_id: 1 }, options: { unique: true } },
    { key: { doctor_id: 1, status: 1, created_at: -1 } },
    { key: { patient_id: 1, created_at: -1 } },
  ],
  research_datasets: [
    { key: { name: 1, version: 1 }, options: { unique: true } },
    { key: { status: 1, created_at: -1 } },
  ],
  research_consents: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { patient_id: 1, created_at: -1 } },
    {
      key: { patient_id: 1, sequence: 1 },
      options: { unique: true, partialFilterExpression: { sequence: { $exists: true } } },
    },
    { key: { user_id: 1, created_at: -1 } },
  ],
  research_dataset_items: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { dataset_id: 1, image_id: 1 }, options: { unique: true } },
    { key: { dataset_id: 1, subject_key: 1, split: 1 } },
    { key: { dataset_id: 1, annotation_status: 1 } },
  ],
  research_annotations: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { item_id: 1 }, options: { unique: true } },
    { key: { item_id: 1, reviewed_at: -1 } },
  ],
  doctors: [{ key: { user_id: 1 }, options: { unique: true } }],
  health_workers: [{ key: { user_id: 1 }, options: { unique: true } }],
  specialists: [{ key: { user_id: 1 }, options: { unique: true } }],
  villages: [{ key: { village_code: 1 }, options: { unique: true } }],
  phcs: [{ key: { phc_code: 1 }, options: { unique: true } }],
  hospitals: [{ key: { hospital_code: 1 }, options: { unique: true } }],
  facility_locations: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { name_key: 1 }, options: { unique: true } },
    { key: { is_active: 1, facility_type: 1 } },
  ],
  aadhaar_uploads: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { uploaded_by: 1, created_at: -1 } },
    { key: { expires_at: 1 } },
  ],
  aadhaar_documents: [
    { key: { id: 1 }, options: { unique: true } },
    { key: { patient_id: 1, created_at: -1 } },
      { key: { patient_id: 1, source_upload_id: 1, page: 1 }, options: { unique: true } },
  ],
};

async function ensureIndexes(database) {
  const hasOtpChallenges = await database
    .listCollections({ name: 'otp_verifications' }, { nameOnly: true })
    .hasNext();
  if (hasOtpChallenges) {
    const otpChallenges = database.collection('otp_verifications');
    const legacyExpiryIndex = (await otpChallenges.indexes()).find(
      (index) => index.key.expires_at === 1 && index.expireAfterSeconds === 0,
    );
    if (legacyExpiryIndex) await otpChallenges.dropIndex(legacyExpiryIndex.name);
    await otpChallenges.updateMany(
      { purge_at: { $exists: false }, created_at: { $type: 'date' } },
      [{ $set: { purge_at: { $add: ['$created_at', 15 * 60 * 1000] } } }],
    );
  }

  const hasStagedAadhaarUploads = await database
    .listCollections({ name: 'aadhaar_uploads' }, { nameOnly: true })
    .hasNext();
  if (hasStagedAadhaarUploads) {
    const stagedUploads = database.collection('aadhaar_uploads');
    const legacyExpiryIndex = (await stagedUploads.indexes()).find(
      (index) => index.key.expires_at === 1 && index.expireAfterSeconds === 0,
    );
    if (legacyExpiryIndex) await stagedUploads.dropIndex(legacyExpiryIndex.name);
  }

  for (const [collectionName, collectionIndexes] of Object.entries(indexes)) {
    const collection = database.collection(collectionName);
    for (const { key, options = {} } of collectionIndexes) {
      await collection.createIndex(key, options);
    }
  }
}

async function connectMongo() {
  if (!connectionPromise) {
    connectionPromise = client
      .connect()
      .then(async () => {
        const database = client.db(databaseName);
        await ensureIndexes(database);
        return database;
      })
      .catch((error) => {
        connectionPromise = undefined;
        throw error;
      });
  }
  return connectionPromise;
}

async function getDb() {
  return connectMongo();
}

async function checkConnection() {
  try {
    const database = await connectMongo();
    await database.command({ ping: 1 });
    logger.info('MongoDB connection verified', { database: databaseName });
  } catch (error) {
    logger.error('MongoDB connection failed', { errorMessage: errorMessage(error) });
    throw error;
  }
}

async function closeMongo() {
  connectionPromise = undefined;
  await client.close();
}

module.exports = {
  connectMongo,
  getDb,
  checkConnection,
  closeMongo,
  ensureIndexes,
  databaseName,
  indexes,
};
