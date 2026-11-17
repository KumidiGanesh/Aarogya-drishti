const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const ownershipGuard = require('../middleware/ownershipGuard');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const upload = require('../middleware/upload');
const {
  registrationSchema,
  listSchema,
  idParams,
  updateSchema,
  deleteSchema,
  historySchema,
  consentSchema,
  aadhaarUploadParams,
  aadhaarDocumentParams,
} = require('./validators');

const router = express.Router();
router.use(authenticate);

router.post(
  '/aadhaar/extract',
  authorize('health_worker', 'doctor', 'admin', 'super_admin'),
  requirePermission('patients:manage'),
  upload.single('file'),
  controller.extractAadhaar,
);
router.delete(
  '/aadhaar/uploads/:uploadId',
  authorize('health_worker', 'doctor', 'admin', 'super_admin'),
  requirePermission('patients:manage'),
  validate(aadhaarUploadParams),
  controller.deleteAadhaarUpload,
);
router.get(
  '/:id/aadhaar-documents/:documentId',
  authorize('doctor', 'health_worker', 'specialist', 'admin', 'super_admin', 'patient'),
  requirePermission('patients:read'),
  validate(aadhaarDocumentParams),
  ownershipGuard(),
  controller.getAadhaarDocument,
);

router.post(
  '/',
  authorize('health_worker', 'doctor', 'admin', 'super_admin'),
  requirePermission('patients:manage'),
  validate(registrationSchema),
  controller.registerPatient,
);
router.get(
  '/',
  authorize('doctor', 'health_worker', 'specialist', 'admin', 'super_admin'),
  requirePermission('patients:read'),
  validate(listSchema),
  controller.listPatients,
);
router.get(
  '/:id',
  authorize('doctor', 'health_worker', 'specialist', 'admin', 'super_admin', 'patient'),
  requirePermission('patients:read'),
  validate(idParams),
  ownershipGuard(),
  controller.getPatient,
);
router.put(
  '/:id',
  authorize('health_worker', 'doctor', 'admin', 'patient'),
  requirePermission('patients:manage', 'patients:self:manage'),
  validate(updateSchema),
  ownershipGuard(),
  controller.updatePatient,
);
router.delete(
  '/:id',
  authorize('admin', 'super_admin'),
  requirePermission('patients:manage'),
  validate(deleteSchema),
  controller.deletePatient,
);
router.get(
  '/:id/history',
  authorize('doctor', 'health_worker', 'specialist', 'admin', 'super_admin', 'patient'),
  requirePermission('patients:read'),
  validate(historySchema),
  ownershipGuard(),
  controller.patientHistory,
);
router.post(
  '/:id/consent',
  authorize('health_worker', 'doctor', 'patient'),
  requirePermission('patients:manage', 'patients:self:manage'),
  validate(consentSchema),
  ownershipGuard(),
  controller.consent,
);

module.exports = router;
