const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const schemas = require('./validators');

const router = express.Router();
router.use(authenticate);
router.post(
  '/',
  authorize('doctor', 'patient', 'admin', 'super_admin'),
  requirePermission('consultations:manage'),
  validate(schemas.createConsultation),
  controller.create,
);
router.get(
  '/',
  authorize('super_admin', 'admin', 'doctor', 'patient'),
  requirePermission('consultations:read'),
  validate(schemas.listConsultations),
  controller.list,
);
router.get(
  '/:id/calls',
  authorize('super_admin', 'admin', 'doctor', 'patient'),
  requirePermission('consultations:read'),
  validate(schemas.consultationParams),
  controller.callHistory,
);
router.get(
  '/:id',
  authorize('super_admin', 'admin', 'doctor', 'patient'),
  requirePermission('consultations:read'),
  validate(schemas.consultationParams),
  controller.getById,
);
router.post(
  '/:id/calls',
  authorize('doctor', 'patient'),
  requirePermission('consultations:manage'),
  validate(schemas.consultationCall),
  controller.callAction,
);

module.exports = router;
