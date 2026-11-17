const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const {
  createAppointment,
  listAppointments,
  updateAppointment,
  appointmentParams,
} = require('./validators');

const router = express.Router();
router.use(authenticate);
router.post(
  '/',
  authorize('patient', 'health_worker', 'doctor', 'admin'),
  requirePermission('appointments:manage'),
  validate(createAppointment),
  controller.create,
);
router.get(
  '/',
  authorize('patient', 'health_worker', 'doctor', 'admin', 'super_admin'),
  requirePermission('appointments:read'),
  validate(listAppointments),
  controller.list,
);
router.put(
  '/:id',
  authorize('patient', 'health_worker', 'doctor', 'admin', 'super_admin'),
  requirePermission('appointments:manage'),
  validate(updateAppointment),
  controller.update,
);
router.delete(
  '/:id',
  authorize('patient', 'admin', 'super_admin'),
  requirePermission('appointments:manage'),
  validate(appointmentParams),
  controller.remove,
);

module.exports = router;
