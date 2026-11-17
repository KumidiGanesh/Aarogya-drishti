const patientService = require('../patients/service');

function ownershipGuard() {
  return async (req, res, next) => {
    try {
      req.patientAccess = await patientService.assertPatientScope(
        req.validated.params.id,
        req.user,
      );
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = ownershipGuard;
