const express = require('express');
const multer = require('multer');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const { referralAction, listReferrals } = require('./validators');

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10, fields: 12, fieldSize: 16 * 1024 },
  fileFilter(_req, file, callback) {
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)) {
      const error = new Error('Only PDF, JPEG, and PNG referral documents are allowed');
      error.status = 422;
      error.code = 'UNSUPPORTED_DOCUMENT_TYPE';
      callback(error);
      return;
    }
    callback(null, true);
  },
});

const router = express.Router();
router.use(authenticate);
router.post(
  '/',
  authorize('doctor', 'specialist', 'health_worker', 'admin', 'super_admin'),
  requirePermission('referrals:manage'),
  documentUpload.array('supporting_documents[]', 10),
  validate(referralAction),
  controller.createOrAct,
);
router.get(
  '/',
  authorize('patient', 'health_worker', 'doctor', 'specialist', 'admin', 'super_admin'),
  requirePermission('referrals:read'),
  validate(listReferrals),
  controller.list,
);

module.exports = router;
