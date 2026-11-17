require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const logger = require('../utils/logger');
const errorMessage = require('../utils/errorMessage');
const { checkConnection, getDb, closeMongo } = require('./mongo');

async function run() {
  const operation = process.argv[2] || 'up';
  if (!['up', 'status'].includes(operation)) {
    throw new Error('MongoDB schema changes are managed through idempotent indexes; rollback is not supported');
  }
  await checkConnection();
  if (operation === 'status') {
    logger.info('MongoDB indexes and collections are ready');
    return;
  }
  const db = await getDb();
  logger.info('MongoDB persistence is ready', { database: db.databaseName });
}

run().catch((error) => {
  logger.error('MongoDB setup failed', { errorMessage: errorMessage(error) });
  process.exitCode = 1;
}).finally(closeMongo);
