const { getDb } = require('../db/mongo');
const { randomUUID } = require('node:crypto');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function get(user) {
  const db = await getDb();
  const account = await db.collection('users').findOne({ id: user.sub, deleted_at: null });
  if (!account) throw httpError(404, 'USER_NOT_FOUND', 'User not found');
  const [userSettings, patient, systemSettings] = await Promise.all([
    db.collection('user_settings').find({ user_id: user.sub }).toArray(),
    db.collection('patients').findOne({ user_id: user.sub }),
    user.role === 'super_admin'
      ? db.collection('system_settings').find({}).sort({ key: 1 }).toArray()
      : Promise.resolve([]),
  ]);
  const settings = Object.fromEntries(userSettings.map(({ key, value }) => [key, value]));
  const privacy = { ...(settings.privacy || {}) };
  if (patient) {
    const consents = await db.collection('patient_consents').find({ patient_id: patient.id }).toArray();
    for (const consent of consents) privacy[consent.consent_type] = consent.granted;
  }
  const data = {
    account: { full_name: account.full_name, email: account.email, mobile: account.mobile },
    language: account.preferred_language,
    notification_preferences: settings.notification_preferences || {},
    privacy,
    font_size: settings.font_size || 'medium',
    voice: settings.voice || { enabled: true, language: `${account.preferred_language}-IN`, speed: 1 },
  };
  if (user.role === 'super_admin') {
    data.system_settings = Object.fromEntries(systemSettings.map(({ key, value }) => [key, value]));
  }
  return data;
}

async function update(input, user, req) {
  const db = await getDb();
  if (input.system_settings && user.role !== 'super_admin') {
    throw httpError(403, 'FORBIDDEN', 'Only super administrators can update system settings');
  }
  if (input.system_settings && !user.permissions?.includes('settings:manage')) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to update system settings');
  }
  const now = new Date();
  const users = db.collection('users');
  const account = {};
  if (input.language !== undefined) account.preferred_language = input.language;
  if (input.account) {
    for (const field of ['full_name', 'mobile', 'email']) {
      if (input.account[field] !== undefined) {
        account[field] = field === 'email' && input.account[field] ? input.account[field].toLowerCase() : input.account[field] || null;
      }
    }
  }
  if (Object.keys(account).length) {
    account.updated_at = now;
    try {
      await users.updateOne({ id: user.sub }, { $set: account });
    } catch (error) {
      if (error.code === 11000) throw httpError(409, 'ACCOUNT_EXISTS', 'Mobile or email is already in use');
      throw error;
    }
  }
  if (input.language !== undefined || input.account?.full_name !== undefined || input.account?.mobile !== undefined) {
    const patientUpdates = {};
    if (input.language !== undefined) patientUpdates.preferred_language = input.language;
    for (const field of ['full_name', 'mobile']) {
      if (input.account?.[field] !== undefined) patientUpdates[field] = input.account[field];
    }
    if (Object.keys(patientUpdates).length) {
      patientUpdates.updated_at = now;
      await db.collection('patients').updateMany({ user_id: user.sub }, { $set: patientUpdates });
    }
  }
  for (const key of ['notification_preferences', 'privacy', 'font_size', 'voice']) {
    if (input[key] === undefined) continue;
    const value = key === 'notification_preferences'
      ? {
        ...input[key],
        types: { ...(input[key].types || {}), emergency: true },
        channels: { ...(input[key].channels || {}), emergency: true },
      }
      : input[key];
    const updateDoc = key === 'privacy'
      ? { $set: { updated_at: now }, $setOnInsert: { id: randomUUID(), user_id: user.sub, key, created_at: now } }
      : { $set: { value, updated_at: now }, $setOnInsert: { id: randomUUID(), user_id: user.sub, key, created_at: now } };
    if (key === 'privacy') {
      for (const [privacyKey, privacyValue] of Object.entries(input.privacy)) {
        updateDoc.$set[`value.${privacyKey}`] = privacyValue;
      }
    }
    await db.collection('user_settings').updateOne({ user_id: user.sub, key }, updateDoc, { upsert: true });
    if (key === 'notification_preferences' && input[key].channels) {
      await db.collection('notification_preferences').updateOne(
        { user_id: user.sub },
        {
          $set: {
            in_app_enabled: input[key].channels.in_app ?? true,
            sms_enabled: input[key].channels.sms ?? false,
            push_enabled: input[key].channels.push ?? false,
            updated_at: now,
          },
          $setOnInsert: { id: randomUUID(), user_id: user.sub, created_at: now },
        },
        { upsert: true },
      );
    }
  }
  if (input.privacy) {
    const patient = await db.collection('patients').findOne({ user_id: user.sub });
    if (patient) {
      for (const [consentType, granted] of Object.entries(input.privacy)) {
        if (!['data_collection', 'photo', 'location', 'teleconsultation'].includes(consentType)) continue;
        await db.collection('patient_consents').updateOne(
          { patient_id: patient.id, consent_type: consentType },
          {
            $set: {
              granted,
              language: account.preferred_language || (await users.findOne({ id: user.sub }))?.preferred_language || 'en',
              granted_at: granted ? now : null,
              revoked_at: granted ? null : now,
              recorded_by: user.sub,
              updated_at: now,
            },
            $setOnInsert: { id: randomUUID(), patient_id: patient.id, consent_type: consentType, created_at: now },
          },
          { upsert: true },
        );
      }
    }
  }
  if (input.system_settings) {
    for (const [key, value] of Object.entries(input.system_settings)) {
      await db.collection('system_settings').updateOne(
        { key },
        { $set: { value, updated_by: user.sub, updated_at: now }, $setOnInsert: { id: randomUUID(), key, created_at: now } },
        { upsert: true },
      );
    }
  }
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: user.sub,
    action: 'settings.update',
    entity: 'user_settings',
    entity_id: user.sub,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata: {
      keys: Object.keys(input).filter((key) => key !== 'account'),
      account_fields: Object.keys(input.account || {}),
      system_keys: Object.keys(input.system_settings || {}),
    },
    created_at: now,
  });
  return get(user);
}

module.exports = { get, update };
