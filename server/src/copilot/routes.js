const express = require('express');
const rateLimit = require('express-rate-limit');
const validate = require('../middleware/validate');
const controller = require('./controller');
const schemas = require('./validators');

const router = express.Router();
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many copilot requests. Please try again later.',
    errors: [],
    code: 'COPILOT_RATE_LIMITED',
  },
});

router.get('/health', controller.health);
router.post('/chat', chatLimiter, validate(schemas.chat), controller.chat);

module.exports = router;
