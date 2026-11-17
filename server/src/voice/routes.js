const express = require('express');
const multer = require('multer');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const schemas = require('../languages/validators');

const router = express.Router();
const roles = [
  authorize('super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient'),
  requirePermission('voice:use'),
];
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!['audio/webm', 'audio/wav', 'audio/x-wav'].includes(file.mimetype.split(';')[0])) {
      const error = new Error('Audio must be WebM or WAV');
      error.status = 422;
      error.code = 'UNSUPPORTED_AUDIO_TYPE';
      callback(error);
      return;
    }
    callback(null, true);
  },
});

router.post(
  '/speech-to-text',
  authenticate,
  roles,
  audioUpload.single('audio'),
  validate(schemas.speechToText),
  controller.speechToText,
);
router.post(
  '/text-to-speech',
  authenticate,
  roles,
  validate(schemas.textToSpeech),
  controller.textToSpeech,
);

module.exports = router;
