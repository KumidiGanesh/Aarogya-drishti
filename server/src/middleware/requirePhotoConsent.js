const patientService = require('../patients/service');

function requirePhotoConsent(
  patientIdFromRequest = (req) => req.params.patientId || req.params.id || req.body?.patient_id,
) {
  return async (req, res, next) => {
    try {
      const patientId = patientIdFromRequest(req);
      if (!patientId) {
        const error = new Error('Patient ID is required before checking photo consent');
        error.status = 400;
        error.code = 'PATIENT_ID_REQUIRED';
        throw error;
      }
      await patientService.assertPhotoConsent(patientId);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = requirePhotoConsent;
