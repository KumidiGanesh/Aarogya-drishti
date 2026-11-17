const localizedMessage = require('../utils/localizedMessage');

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: localizedMessage(req, 'UNAUTHENTICATED', 'Authentication required'),
        errors: [],
        code: 'UNAUTHENTICATED',
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: localizedMessage(req, 'FORBIDDEN', 'You do not have permission to perform this action'),
        errors: [],
        code: 'FORBIDDEN',
      });
    }
    return next();
  };
}

module.exports = authorize;
