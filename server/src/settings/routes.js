const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const schemas = require('./validators');

const router = express.Router();
router.use(authenticate, authorize('super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient'));
router.get('/', requirePermission('settings:read'), controller.get);
router.put(
  '/',
  requirePermission('settings:manage', 'settings:self:manage'),
  validate(schemas.updateSettings),
  controller.update,
);

module.exports = router;
