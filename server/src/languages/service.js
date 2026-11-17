const { getDb } = require('../db/mongo');
const { randomUUID } = require('node:crypto');

async function listLanguages({ lang, namespace }) {
  const db = await getDb();
  const languages = await db.collection('languages').find({ is_active: true }).sort({ code: 1 }).toArray();
  languages.sort((left, right) => {
    const preferred = ['en', 'te', 'hi', 'or'];
    return (preferred.indexOf(left.code) < 0 ? 99 : preferred.indexOf(left.code))
      - (preferred.indexOf(right.code) < 0 ? 99 : preferred.indexOf(right.code));
  });
  const result = languages.map(({ code, native_name, english_name }) => ({ code, native_name, english_name }));
  let translationContents;
  if (lang) {
    const filter = { language_code: lang };
    if (namespace) filter.key = { $regex: `^${namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.` };
    const rows = await db.collection('translation_contents').find(filter).sort({ key: 1 }).toArray();
    translationContents = Object.fromEntries(rows.map((row) => [row.key, {
      value: row.value,
      reviewed_by_clinician: row.reviewed_by_clinician,
    }]));
  }
  return {
    languages: result,
    ...(translationContents ? { translation_contents: translationContents } : {}),
  };
}

async function updatePreference(userId, languageCode, req) {
  const db = await getDb();
  const language = await db.collection('languages').findOne({ code: languageCode, is_active: true });
  if (!language) {
    const error = new Error('Selected language is not active');
    error.status = 422;
    error.code = 'LANGUAGE_INACTIVE';
    throw error;
  }
  const updated = await db.collection('users').updateOne(
    { id: userId, is_active: true, deleted_at: null },
    { $set: { preferred_language: languageCode, updated_at: new Date() } },
  );
  if (!updated.matchedCount) {
    const error = new Error('User account is not active');
    error.status = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }
  await db.collection('patients').updateMany(
    { user_id: userId, deleted_at: null },
    { $set: { preferred_language: languageCode, updated_at: new Date() } },
  );
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: userId,
    action: 'language.preference.updated',
    entity: 'user',
    entity_id: userId,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata: { preferred_language: languageCode },
    created_at: new Date(),
  });
  return { language_code: languageCode };
}

module.exports = { listLanguages, updatePreference };
