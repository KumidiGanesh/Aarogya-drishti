const multer = require('multer');

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!allowedMimeTypes.has(file.mimetype)) {
      const error = new Error('Unsupported file type');
      error.status = 422;
      error.code = 'UNSUPPORTED_FILE_TYPE';
      callback(error);
      return;
    }
    callback(null, true);
  },
});

module.exports = upload;
