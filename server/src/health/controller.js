const { checkConnection } = require('../db/mongo');

async function getHealth(_req, res) {
  try {
    await checkConnection();
    return res.status(200).json({
      success: true,
      application: 'AAROGYA DRISHTI',
      server: 'running',
      database: 'connected',
      message: 'Health check passed',
      data: { status: 'ok' },
      meta: {},
    });
  } catch {
    return res.status(503).json({
      success: false,
      application: 'AAROGYA DRISHTI',
      server: 'running',
      database: 'disconnected',
      message: 'Database is unavailable',
      errors: [],
      code: 'DATABASE_UNAVAILABLE',
    });
  }
}

module.exports = { getHealth };
