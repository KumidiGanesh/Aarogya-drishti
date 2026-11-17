const screeningService = require('./service');

async function create(req, res, next) {
  try {
    const result = await screeningService.createScreening(req.validated.body, req);
    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created ? 'Screening created' : 'Screening already exists',
      data: { screening: result.screening },
      meta: { idempotent: !result.created },
    });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const result = await screeningService.listScreenings(req.validated.query, req.user);
    return res.status(200).json({
      success: true,
      message: 'Screenings loaded',
      data: { items: result.items },
      meta: result.meta,
    });
  } catch (error) {
    return next(error);
  }
}

async function availableDoctors(req, res, next) {
  try {
    const result = await screeningService.availableDoctors(req.user);
    return res.status(200).json({
      success: true,
      message: 'Doctors loaded',
      data: { items: result },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function doctorRequests(req, res, next) {
  try {
    const result = await screeningService.listDoctorRequests(req.user);
    return res.status(200).json({
      success: true,
      message: 'Screening doctor requests loaded',
      data: { items: result },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function createDoctorRequest(req, res, next) {
  try {
    const result = await screeningService.createDoctorRequest(
      req.validated.params.id,
      req.validated.body.doctor_id,
      req.user,
      req,
    );
    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created ? 'Screening sent to doctor' : 'Screening request already exists',
      data: { request: result.request },
      meta: { idempotent: !result.created },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateDoctorRequestStatus(req, res, next) {
  try {
    const result = await screeningService.updateDoctorRequestStatus(
      req.validated.params.id,
      req.validated.body.status,
      req.user,
      req,
    );
    return res.status(200).json({
      success: true,
      message: 'Screening request status updated',
      data: { request: result },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function detail(req, res, next) {
  try {
    const result = await screeningService.screeningDetail(req.validated.params.id, req.user, req);
    if (result.stream) {
      const { buffer, mimeType, imageId } = result.stream;
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mimeType];
      res.set({
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="screening-${imageId}.${extension}"`,
        'Content-Type': mimeType,
        'Content-Length': buffer.length,
      });
      return res.status(200).send(buffer);
    }
    return res.status(200).json({
      success: true,
      message: 'Screening loaded',
      data: { screening: result.screening },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function uploadImages(req, res, next) {
  try {
    if (!req.files?.length) {
      const error = new Error('Choose at least one image to upload');
      error.status = 400;
      error.code = 'IMAGES_REQUIRED';
      throw error;
    }
    const result = await screeningService.uploadImages(
      req.validated.params.id,
      req.files,
      {
        site: req.validated.body.site,
        acceptLowQuality: req.validated.body.accept_low_quality === 'true',
      },
      req.user,
      req,
    );
    return res.status(201).json({
      success: true,
      message: 'Screening images uploaded privately',
      data: result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function aiAnalysis(req, res, next) {
  try {
    const result = await screeningService.runAiAnalysis(req.validated.params.id, req.user, req);
    return res.status(200).json({
      success: true,
      message: result.is_demo
        ? 'Demonstration result generated from questionnaire data only; images were not analyzed.'
        : result.inference_status === 'inconclusive'
          ? 'Image analysis was inconclusive; no medical risk estimate was generated.'
          : 'Preliminary visual observations completed. Gemini is not clinically validated for oral disease screening; clinician review is required.',
      data: { result },
      meta: { is_demo: result.is_demo, model_version: result.model_version },
    });
  } catch (error) {
    return next(error);
  }
}

async function clinicalReview(req, res, next) {
  try {
    const result = await screeningService.submitClinicalReview(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req,
    );
    return res.status(201).json({
      success: true,
      message: 'Clinical review saved',
      data: result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  create,
  list,
  detail,
  uploadImages,
  aiAnalysis,
  clinicalReview,
  availableDoctors,
  doctorRequests,
  createDoctorRequest,
  updateDoctorRequestStatus,
};
