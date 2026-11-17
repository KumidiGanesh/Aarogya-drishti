require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const http = require('node:http');
const app = require('./app');
const logger = require('./utils/logger');
const errorMessage = require('./utils/errorMessage');
const { attachTelemedicineSockets } = require('./telemedicine/signaling');
const { checkConnection, closeMongo, getDb } = require('./db/mongo');
const { ensurePermissionCatalog } = require('./auth/permissions');
const cron = require('node-cron');
const { dispatchAppointmentReminders } = require('./appointments/service');
const { dispatchMedicineReminders } = require('./jobs/medicineReminderJob');
const { dispatchScheduledNotifications } = require('./jobs/notificationScheduleJob');
const { cleanupExpiredStagedUploads } = require('./patients/aadhaarService');

const port = Number(process.env.APP_PORT) || 4000;
let server;
let io;
let shuttingDown = false;
let reminderJob;
let medicineReminderJob;
let notificationScheduleJob;
let aadhaarUploadCleanupJob;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Graceful shutdown started', { signal });
  try {
    reminderJob?.stop();
    medicineReminderJob?.stop();
    notificationScheduleJob?.stop();
    aadhaarUploadCleanupJob?.stop();
    if (io) {
      await new Promise((resolve) => io.close(resolve));
      io = undefined;
      server = undefined;
    } else if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await closeMongo();
  } catch (error) {
    logger.error('Failed to shut down cleanly', { errorMessage: errorMessage(error) });
    process.exitCode = 1;
  }
}

async function start() {
  await checkConnection();
  await ensurePermissionCatalog(await getDb());
  reminderJob = cron.schedule('*/5 * * * *', async () => {
    try {
      await dispatchAppointmentReminders();
    } catch (error) {
      logger.error('Appointment reminder job failed', { errorMessage: errorMessage(error) });
    }
  });
  medicineReminderJob = cron.schedule('* * * * *', async () => {
    try {
      await dispatchMedicineReminders();
    } catch (error) {
      logger.error('Medicine reminder job failed', { errorMessage: errorMessage(error) });
    }
  });
  notificationScheduleJob = cron.schedule('* * * * *', async () => {
    try {
      await dispatchScheduledNotifications();
    } catch (error) {
      logger.error('Scheduled notification job failed', { errorMessage: errorMessage(error) });
    }
  });
  aadhaarUploadCleanupJob = cron.schedule('*/15 * * * *', async () => {
    try {
      await cleanupExpiredStagedUploads();
    } catch (error) {
      logger.error('Expired Aadhaar upload cleanup failed', { errorMessage: errorMessage(error) });
    }
  });
  server = http.createServer(app);
  io = attachTelemedicineSockets(server);
  server.listen(port, () => {
    logger.info(`Aarogya Drishti API listening on port ${port}`);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdown(signal);
  });
}

start().catch(async (error) => {
  logger.error('API startup failed', { errorMessage: errorMessage(error) });
  process.exitCode = 1;
  await shutdown('startup-error');
});
