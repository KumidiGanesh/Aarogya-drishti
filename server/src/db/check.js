require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const logger = require('../utils/logger');
const errorMessage = require('../utils/errorMessage');
const { checkConnection, getDb, closeMongo } = require('./mongo');

async function run() {
  await checkConnection();
  const db = await getDb();
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const collectionNames = new Set(collections.map(({ name }) => name));
  const requiredCollections = ['roles', 'permissions', 'users', 'patients', 'refresh_tokens', 'audit_logs'];
  const missingCollections = requiredCollections.filter((name) => !collectionNames.has(name));
  if (missingCollections.length) {
    throw new Error(`MongoDB is missing required collections: ${missingCollections.join(', ')}`);
  }
  logger.info('MongoDB collections verified', {
    database: db.databaseName,
    collectionCount: collectionNames.size,
    requiredCollections,
  });
}

run()
  .catch((error) => {
    logger.error('MongoDB check failed', { errorMessage: errorMessage(error) });
    process.exitCode = 1;
  })
  .finally(closeMongo);
