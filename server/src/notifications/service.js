const { getDb } = require('../db/mongo');
const { randomUUID } = require('node:crypto');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function dateBound(value, end = false) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (end) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

async function list(userId, query) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw httpError(400, 'INVALID_PAGINATION', 'limit must be between 1 and 100');
  }
  const filter = { user_id: userId };
  if (query.type) filter.notification_type = query.type;
  if (query.is_read !== undefined) filter.is_read = query.is_read === 'true';
  if (query.from || query.to || query.date) {
    const from = [query.from, query.date].filter(Boolean).map((value) => dateBound(value))
      .sort((left, right) => right - left)[0];
    const to = [query.to, query.date].filter(Boolean).map((value) => dateBound(value, true))
      .sort((left, right) => left - right)[0];
    filter.created_at = {};
    if (from) filter.created_at.$gte = from;
    if (to) filter.created_at.$lt = to;
  }
  const db = await getDb();
  const notifications = db.collection('notifications');
  const [total, unreadCount, items] = await Promise.all([
    notifications.countDocuments(filter),
    notifications.countDocuments({ user_id: userId, is_read: { $ne: true } }),
    notifications.find(filter, {
      projection: { _id: 0, id: 1, notification_type: 1, title: 1, body: 1, data: 1, read_at: 1, created_at: 1 },
    }).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
  ]);
  return {
    items,
    unread_count: unreadCount,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function markRead(userId, id, req) {
  const db = await getDb();
  const notifications = db.collection('notifications');
  const now = new Date();
  const filter = { user_id: userId, is_read: { $ne: true } };
  if (id !== 'all') filter.id = id;
  const result = await notifications.updateMany(filter, { $set: { read_at: now, is_read: true } });
  if (id !== 'all' && result.matchedCount === 0) {
    const exists = await notifications.findOne({ user_id: userId, id }, { projection: { _id: 1 } });
    if (!exists) throw httpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: userId,
    action: 'notification.read',
    entity: 'notifications',
    entity_id: id === 'all' ? null : id,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata: { count: result.modifiedCount },
    created_at: now,
  });
  return { id, updated: result.modifiedCount };
}

async function updatePreferences(userId, input, req) {
  const db = await getDb();
  const settings = db.collection('user_settings');
  const current = await settings.findOne({ user_id: userId, key: 'notification_preferences' });
  const previous = current?.value || {};
  const next = {
    ...previous,
    types: { ...(previous.types || {}), ...(input.types || {}), emergency: true },
    channels: { ...(previous.channels || {}), ...(input.channels || {}), emergency: true },
    quiet_hours: input.quiet_hours ?? previous.quiet_hours ?? { enabled: false, start: '22:00', end: '07:00' },
  };
  const now = new Date();
  await settings.updateOne(
    { user_id: userId, key: 'notification_preferences' },
    { $set: { value: next, updated_at: now }, $setOnInsert: { created_at: now } },
    { upsert: true },
  );
  if (input.channels) {
    await db.collection('notification_preferences').updateOne(
      { user_id: userId },
      {
        $set: {
          in_app_enabled: input.channels.in_app ?? true,
          sms_enabled: input.channels.sms ?? false,
          push_enabled: input.channels.push ?? false,
          updated_at: now,
        },
        $setOnInsert: { id: randomUUID(), user_id: userId, created_at: now },
      },
      { upsert: true },
    );
  }
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: userId,
    action: 'notification.preferences.update',
    entity: 'user_settings',
    entity_id: userId,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata: {},
    created_at: now,
  });
  return next;
}

module.exports = { list, markRead, updatePreferences };
