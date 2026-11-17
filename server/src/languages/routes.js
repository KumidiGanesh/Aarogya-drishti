const express = require('express');
const rateLimit = require('express-rate-limit');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const localizedMessage = require('../utils/localizedMessage');
const controller = require('./controller');
const schemas = require('./validators');

const router = express.Router();
const translationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || req.ip,
  message: (req) => ({
    success: false,
    message: localizedMessage(
      req,
      'TRANSLATION_RATE_LIMITED',
      'Translation request limit reached. Try again later.',
    ),
    errors: [],
    code: 'TRANSLATION_RATE_LIMITED',
  }),
});

router.get('/languages', validate(schemas.listLanguages), controller.list);
router.put(
  '/languages/preference',
  authenticate,
  authorize('super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient'),
  requirePermission('languages:use'),
  validate(schemas.updatePreference),
  controller.preference,
);
router.post(
  '/language/translate',
  authenticate,
  authorize('super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient'),
  requirePermission('languages:use'),
  translationLimiter,
  validate(schemas.translate),
  controller.translate,
);

module.exports = router;
