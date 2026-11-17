const express = require('express');
const multer = require('multer');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const {
  screeningCreate,
  listScreenings,
  screeningParams,
  doctorRequest,
  doctorRequestStatus,
  uploadImages,
  clinicalReview,
} = require('./validators');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 6,
    fields: 4,
    fieldSize: 256,
  },
  fileFilter(_req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Only JPEG, PNG, and WebP images are allowed');
      error.status = 422;
      error.code = 'UNSUPPORTED_IMAGE_TYPE';
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
  authorize('health_worker', 'doctor', 'patient'),
  requirePermission('screenings:manage', 'screenings:self:manage'),
  validate(screeningCreate),
  controller.create,
);
router.get(
  '/doctors',
  authorize('patient'),
  requirePermission('screenings:self:manage'),
  controller.availableDoctors,
);
router.get(
  '/doctor-requests',
  authorize('doctor', 'patient'),
  requirePermission('screenings:read'),
  controller.doctorRequests,
);
router.get(
  '/',
  authorize('health_worker', 'doctor', 'specialist', 'admin', 'super_admin', 'patient'),
  requirePermission('screenings:read'),
  validate(listScreenings),
  controller.list,
);
router.post(
  '/:id/doctor-request',
  authorize('patient'),
  requirePermission('screenings:self:manage'),
  validate(doctorRequest),
  controller.createDoctorRequest,
);
router.post(
  '/:id/doctor-request/status',
  authorize('doctor'),
  requirePermission('screenings:manage'),
  validate(doctorRequestStatus),
  controller.updateDoctorRequestStatus,
);
router.get(
  '/:id',
  authorize('health_worker', 'doctor', 'specialist', 'admin', 'super_admin', 'patient'),
  requirePermission('screenings:read'),
  validate(screeningParams),
  controller.detail,
);
router.post(
  '/:id/upload-image',
  authorize('health_worker', 'doctor', 'patient'),
  requirePermission('screenings:manage', 'screenings:self:manage'),
  validate(screeningParams),
  imageUpload.array('images', 6),
  validate(uploadImages),
  controller.uploadImages,
);
router.post(
  '/:id/ai-analysis',
  authorize('health_worker', 'doctor', 'specialist', 'patient'),
  requirePermission('screenings:manage', 'screenings:self:manage'),
  validate(screeningParams),
  controller.aiAnalysis,
);
router.post(
  '/:id/clinical-review',
  authorize('doctor', 'specialist'),
  requirePermission('screenings:manage'),
  validate(clinicalReview),
  controller.clinicalReview,
);

module.exports = router;
