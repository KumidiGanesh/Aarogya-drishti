require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const cors = require('cors');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const swaggerUi = require('swagger-ui-express');
const openApiSpec = require('./openapi');
const logger = require('./utils/logger');
const errorMessage = require('./utils/errorMessage');
const localizedMessage = require('./utils/localizedMessage');
const getAllowedOrigins = require('./utils/allowedOrigins');

const app = express();
const trustProxy =
  process.env.TRUST_PROXY === 'true'
    ? 1
    : process.env.TRUST_PROXY === 'false'
      ? false
      : process.env.NODE_ENV === 'production'
        ? 1
        : false;
app.set('trust proxy', trustProxy);
const authRoutes = require('./auth/routes');
const patientAuthRoutes = require('./auth/patientRoutes');
const adminRoutes = require('./admin/routes');
const patientRoutes = require('./patients/routes');
const screeningRoutes = require('./screenings/routes');
const researchRoutes = require('./research/routes');
const appointmentRoutes = require('./appointments/routes');
const referralRoutes = require('./referrals/routes');
const medicineRoutes = require('./medicines/routes');
const emergencyRoutes = require('./emergency/routes');
const languageRoutes = require('./languages/routes');
const voiceRoutes = require('./voice/routes');
const notificationRoutes = require('./notifications/routes');
const consultationRoutes = require('./consultations/routes');
const reportsRoutes = require('./reports/routes');
const settingsRoutes = require('./settings/routes');
const copilotRoutes = require('./copilot/routes');
const healthRoutes = require('./health/routes');
const allowedOrigins = getAllowedOrigins();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    strictTransportSecurity:
      process.env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true, preload: false }
        : false,
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use((req, res, next) => {
  const requestId = req.get('x-request-id') || uuidv4();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && !req.secure && req.path !== '/healthz') {
    res.status(426).json({
      success: false,
      message: 'HTTPS is required',
      errors: [],
      code: 'HTTPS_REQUIRED',
    });
    return;
  }
  next();
});
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
morgan.token('safe-url', (req) => {
  const parsed = new URL(req.originalUrl, 'http://localhost');
  for (const key of ['lat', 'lng', 'latitude', 'longitude']) parsed.searchParams.delete(key);
  return `${parsed.pathname}${parsed.search}`;
});
app.use(
  morgan(
    ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"',
    {
      stream: { write: (message) => logger.info(message.trim()) },
    },
  ),
);
app.use(
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX) || 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: (req) => ({
      success: false,
      message: localizedMessage(req, 'RATE_LIMITED', 'Too many requests. Please try again later.'),
      errors: [],
      code: 'RATE_LIMITED',
    }),
  }),
);

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Service is healthy',
    data: { status: 'ok' },
    meta: {},
  });
});

app.use('/api/health', healthRoutes);
app.get('/api-docs/openapi.json', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(openApiSpec);
});
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    explorer: false,
    swaggerOptions: { displayRequestDuration: true, persistAuthorization: false },
  }),
);

app.use('/api/auth', authRoutes);
app.use('/api/patient', patientAuthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/screenings', screeningRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/medicines', medicineRoutes.medicines);
app.use('/api/medicine-reminders', medicineRoutes.reminders);
app.use('/api/medicine-logs', medicineRoutes.logs);
app.use('/api/emergency', emergencyRoutes);
app.use('/api', languageRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/copilot', copilotRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: localizedMessage(req, 'NOT_FOUND', 'Route not found'),
    errors: [],
    code: 'NOT_FOUND',
  });
});

app.use((error, req, res, _next) => {
  logger.error('Unhandled request error', {
    requestId: req.id,
    errorMessage: errorMessage(error),
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  });

  if (res.headersSent) return;
  const isDatabaseError = error.name?.startsWith('Mongo');
  const status = Number.isInteger(error.status)
    ? error.status
    : isDatabaseError
      ? 503
      : error.name === 'MulterError'
        ? error.code === 'LIMIT_FILE_SIZE'
          ? 413
          : 422
        : error.type === 'entity.parse.failed'
          ? 400
          : error.type === 'entity.too.large'
            ? 413
            : 500;
  const responseCode = isDatabaseError
    ? 'DATABASE_UNAVAILABLE'
    : error.name === 'MulterError'
      ? error.code === 'LIMIT_FILE_SIZE'
        ? 'UPLOAD_TOO_LARGE'
        : 'UPLOAD_REJECTED'
      : error.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
  res.status(status).json({
    success: false,
    message:
      responseCode === 'DATABASE_UNAVAILABLE'
        ? localizedMessage(req, responseCode, 'Database is unavailable')
        : status >= 500
          ? localizedMessage(req, responseCode, 'Internal server error')
          : localizedMessage(req, responseCode, error.message),
    errors: responseCode === 'DATABASE_UNAVAILABLE'
      ? []
      : error.candidates
      ? [{ code: 'PATIENT_DUPLICATE', candidates: error.candidates }]
      : error.details
        ? [error.details]
        : error.errors || [],
    code: responseCode,
  });
});

module.exports = app;
