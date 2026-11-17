const service = require('./service');
const translator = require('../adapters/translator');

async function list(req, res, next) {
  try {
    const data = await service.listLanguages(req.validated.query);
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.status(200).json({ success: true, message: 'Languages loaded', data, meta: {} });
  } catch (error) {
    next(error);
  }
}

async function preference(req, res, next) {
  try {
    const data = await service.updatePreference(
      req.user.sub,
      req.validated.body.language_code,
      req,
    );
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, message: 'Language preference saved', data, meta: {} });
  } catch (error) {
    next(error);
  }
}

async function translate(req, res, next) {
  try {
    const data = await translator.translate(req.validated.body);
    res.status(200).json({
      success: true,
      message: data.mode === 'chat' ? 'Chatbot response generated' : 'Translation completed',
      data,
      meta: {},
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { list, preference, translate };
