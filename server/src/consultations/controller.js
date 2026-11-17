const service = require('./service');

async function create(req, res, next) {
  try {
    const data = await service.create(req.validated.body, req.user, req);
    res.status(200).json({ success: true, message: 'Consultation updated', data, meta: {} });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const result = await service.list(req.validated.query, req.user);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      success: true,
      message: 'Consultations loaded',
      data: result.availability
        ? {
            items: result.items,
            availability: result.availability,
            provider_configured: result.provider_configured,
            call_signaling_configured: result.call_signaling_configured,
          }
        : {
            items: result.items,
            provider_configured: result.provider_configured,
            call_signaling_configured: result.call_signaling_configured,
          },
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
}

async function getById(req, res, next) {
  try {
    const data = await service.getById(req.validated.params.id, req.user);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, message: 'Consultation loaded', data, meta: {} });
  } catch (error) {
    next(error);
  }
}

async function callHistory(req, res, next) {
  try {
    const items = await service.getCallHistory(req.validated.params.id, req.user);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      success: true,
      message: 'Consultation call history loaded',
      data: { items },
      meta: {},
    });
  } catch (error) {
    next(error);
  }
}

async function callAction(req, res, next) {
  try {
    const data = await service.callAction(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req,
    );
    res.status(200).json({
      success: true,
      message: 'Consultation call updated',
      data,
      meta: {},
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { create, list, getById, callHistory, callAction };
