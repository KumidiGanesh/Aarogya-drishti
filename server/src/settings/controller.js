const service = require('./service');

async function get(req, res, next) {
  try {
    const data = await service.get(req.user);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, message: 'Settings loaded', data, meta: {} });
  } catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    const data = await service.update(req.validated.body, req.user, req);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, message: 'Settings saved', data, meta: {} });
  } catch (error) { next(error); }
}

module.exports = { get, update };
