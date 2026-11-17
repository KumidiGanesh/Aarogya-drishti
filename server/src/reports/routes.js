const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const schemas = require('./validators');

const router = express.Router();
router.get(
  '/analytics',
  authenticate,
  authorize('super_admin', 'admin', 'doctor'),
  requirePermission('reports:read'),
  validate(schemas.analytics),
  controller.analytics,
);

module.exports = router;
