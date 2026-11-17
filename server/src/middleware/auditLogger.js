const logger = require('../utils/logger');

function auditLogger(action) {
  return (req, res, next) => {
    res.on('finish', () => {
      logger.info('Audit event', {
        requestId: req.id,
        action,
        userId: req.user?.sub || req.user?.id || null,
        role: req.user?.role || null,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
      });
    });
    next();
  };
}

module.exports = auditLogger;
