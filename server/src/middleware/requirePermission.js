function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        errors: [],
        code: 'UNAUTHENTICATED',
      });
    }
    if (
      !permissions.length
      || !Array.isArray(req.user.permissions)
      || !permissions.some((permission) => req.user.permissions.includes(permission))
    ) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to perform this action',
        errors: [],
        code: 'FORBIDDEN',
      });
    }
    return next();
  };
}

module.exports = requirePermission;
