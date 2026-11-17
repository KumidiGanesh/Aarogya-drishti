const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const schemas = require('./validators');

const router = express.Router();
router.use(authenticate, authorize('super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient'));
router.get('/', requirePermission('notifications:read'), validate(schemas.listNotifications), controller.list);
router.put(
  '/:id/read',
  requirePermission('notifications:manage'),
  validate(schemas.notificationId),
  controller.markRead,
);
router.put(
  '/preferences',
  requirePermission('notifications:manage'),
  validate(schemas.updatePreferences),
  controller.preferences,
);

module.exports = router;
