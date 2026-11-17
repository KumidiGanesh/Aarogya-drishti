require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const logger = require('../utils/logger');
const { checkConnection, getDb, closeMongo } = require('./mongo');
const { seedFacilityDirectory } = require('./facilityDirectorySeed');

async function seedFacilities() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Facility directory seeding is disabled in production');
  }
  await checkConnection();
  const db = await getDb();
  const { hospitals, primaryCareFacilities } = await seedFacilityDirectory(db);
  return {
    database: db.databaseName,
    hospitals: hospitals.length,
    primaryCareFacilities: primaryCareFacilities.length,
  };
}

seedFacilities()
  .then((result) => logger.info('Facility directory seed completed', result))
  .catch((error) => {
    logger.error('Facility directory seed failed', { errorMessage: error.message });
    process.exitCode = 1;
  })
  .finally(closeMongo);
