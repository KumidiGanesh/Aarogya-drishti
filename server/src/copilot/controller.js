const service = require('./service');

function health(_req, res) {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({
    success: true,
    message: 'Copilot service status loaded',
    data: service.health(),
    meta: {},
  });
}

async function chat(req, res, next) {
  try {
    const data = await service.answer(req.validated.body);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      success: true,
      message: 'Copilot answer generated',
      data,
      meta: {},
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { health, chat };
