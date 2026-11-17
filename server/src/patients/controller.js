const patientService = require('./service');
const aadhaarService = require('./aadhaarService');

function sendError(next, error) {
  return next(error);
}

async function registerPatient(req, res, next) {
  try {
    const result = await patientService.registerPatient(req.validated.body, req);
    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created ? 'Patient registered' : 'Patient registration already synced',
      data: {
        patient: result.patient,
        ...(result.temporary_password ? { temporary_password: result.temporary_password } : {}),
      },
      meta: { idempotent: !result.created },
    });
  } catch (error) {
    return sendError(next, error);
  }
}

async function extractAadhaar(req, res, next) {
  try {
    const data = await aadhaarService.extractAndStage(req.file, req.body || {}, req);
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    return res.status(200).json({
      success: true,
      message: 'Aadhaar details extracted for review',
      data,
      meta: { authenticity_verified: false },
    });
  } catch (error) {
    return sendError(next, error);
  } finally {
    req.file?.buffer?.fill(0);
  }
}

async function deleteAadhaarUpload(req, res, next) {
  try {
    await aadhaarService.deleteStaged(req.validated.params.uploadId, req);
    return res.status(204).end();
  } catch (error) {
    return sendError(next, error);
  }
}

async function getAadhaarDocument(req, res, next) {
  try {
    const { content, side, page } = await aadhaarService.getDocument(
      req.validated.params.id,
      req.validated.params.documentId,
      req.user,
      req,
    );
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="aadhaar-redacted-${side}-${page}.png"`);
    return res.status(200).send(content);
  } catch (error) {
    return sendError(next, error);
  }
}

async function listPatients(req, res, next) {
  try {
    const result = await patientService.listPatients(req.validated.query, req.user, req);
    return res.status(200).json({
      success: true,
      message: 'Patients loaded',
      data: { items: result.items },
      meta: result.meta,
    });
  } catch (error) {
    return sendError(next, error);
  }
}

async function getPatient(req, res, next) {
  try {
    const patient = await patientService.getPatient(req.validated.params.id, req.user, req);
    return res.status(200).json({
      success: true,
      message: 'Patient loaded',
      data: { patient },
      meta: {},
    });
  } catch (error) {
    return sendError(next, error);
  }
}

async function updatePatient(req, res, next) {
  try {
    const result = await patientService.updatePatient(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req,
    );
    return res.status(200).json({
      success: true,
      message: 'Patient updated',
      data: result,
      meta: {},
    });
  } catch (error) {
    return sendError(next, error);
  }
}

async function deletePatient(req, res, next) {
  try {
    await patientService.deletePatient(req.validated.params.id, req.validated.body.reason, req);
    return res.status(204).end();
  } catch (error) {
    return sendError(next, error);
  }
}

async function patientHistory(req, res, next) {
  try {
    const result = await patientService.history(
      req.validated.params.id,
      req.validated.query,
      req.user,
      req,
    );
    return res.status(200).json({
      success: true,
      message: 'Patient history loaded',
      data: { items: result.items },
      meta: result.meta,
    });
  } catch (error) {
    return sendError(next, error);
  }
}

async function consent(req, res, next) {
  try {
    const data = await patientService.recordConsent(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req,
    );
    return res.status(200).json({
      success: true,
      message: data.granted ? 'Consent recorded' : 'Consent revoked',
      data,
      meta: {},
    });
  } catch (error) {
    return sendError(next, error);
  }
}

module.exports = {
  registerPatient,
  extractAadhaar,
  deleteAadhaarUpload,
  getAadhaarDocument,
  listPatients,
  getPatient,
  updatePatient,
  deletePatient,
  patientHistory,
  consent,
};
