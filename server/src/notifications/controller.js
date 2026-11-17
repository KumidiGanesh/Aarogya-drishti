const service = require('./service');

async function list(req, res, next) {
  try {
    const result = await service.list(req.user.sub, req.validated.query);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, message: 'Notifications loaded', data: { items: result.items, unread_count: result.unread_count }, meta: result.meta });
  } catch (error) { next(error); }
}

async function markRead(req, res, next) {
  try {
    const data = await service.markRead(req.user.sub, req.validated.params.id, req);
    res.status(200).json({ success: true, message: 'Notification marked as read', data, meta: {} });
  } catch (error) { next(error); }
}

async function preferences(req, res, next) {
  try {
    const data = await service.updatePreferences(req.user.sub, req.validated.body, req);
    res.status(200).json({ success: true, message: 'Notification preferences saved', data, meta: {} });
  } catch (error) { next(error); }
}

module.exports = { list, markRead, preferences };
