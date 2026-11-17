require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const logger = require('../utils/logger');
const { checkConnection, getDb, closeMongo } = require('./mongo');
const { seedDemoAppointmentDoctors } = require('./demoAppointmentSeed');

async function seedDemoAppointments() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Synthetic appointment demo seeding is disabled in production');
  }
  await checkConnection();
  const db = await getDb();
  const doctors = await seedDemoAppointmentDoctors(db);
  return { database: db.databaseName, demoDoctors: doctors.length };
}

seedDemoAppointments()
  .then((result) => logger.info('Appointment demo seed completed', result))
  .catch((error) => {
    logger.error('Appointment demo seed failed', { errorMessage: error.message });
    process.exitCode = 1;
  })
  .finally(closeMongo);
