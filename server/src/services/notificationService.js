const { getDb } = require('../db/mongo');
const logger = require('../utils/logger');
const smsAdapter = require('../emergency/smsAdapter');
const { createHash, randomUUID } = require('node:crypto');

const typeCopy = {
  appointment: {
    en: ['Appointment update', 'There is an update about your appointment.'],
    te: ['అపాయింట్‌మెంట్ అప్‌డేట్', 'మీ అపాయింట్‌మెంట్ గురించి అప్‌డేట్ ఉంది.'],
    hi: ['अपॉइंटमेंट अपडेट', 'आपके अपॉइंटमेंट के बारे में एक अपडेट है।'],
    or: ['ନିଯୁକ୍ତି ଅପଡେଟ୍', 'ଆପଣଙ୍କ ନିଯୁକ୍ତି ବିଷୟରେ ଏକ ଅପଡେଟ୍ ଅଛି।'],
  },
  medicine: {
    en: ['Medicine reminder', 'It is time for a scheduled dose.'],
    te: ['మందుల రిమైండర్', 'షెడ్యూల్ చేసిన మందు తీసుకునే సమయం అయింది.'],
    hi: ['दवा रिमाइंडर', 'निर्धारित दवा लेने का समय हो गया है।'],
    or: ['ଔଷଧ ସ୍ମାରକ', 'ନିର୍ଦ୍ଧାରିତ ଔଷଧ ଖାଇବା ସମୟ ହୋଇଛି।'],
  },
  referral: {
    en: ['Referral update', 'There is an update about a referral.'],
    te: ['రిఫరల్ అప్‌డేట్', 'రిఫరల్ గురించి అప్‌డేట్ ఉంది.'],
    hi: ['रेफ़रल अपडेट', 'रेफ़रल के बारे में एक अपडेट है।'],
    or: ['ରେଫରାଲ୍ ଅପଡେଟ୍', 'ରେଫରାଲ୍ ବିଷୟରେ ଏକ ଅପଡେଟ୍ ଅଛି।'],
  },
  consultation: {
    en: ['Consultation update', 'There is an update about your consultation.'],
    te: ['సంప్రదింపు అప్‌డేట్', 'మీ సంప్రదింపు గురించి అప్‌డేట్ ఉంది.'],
    hi: ['परामर्श अपडेट', 'आपके परामर्श के बारे में एक अपडेट है।'],
    or: ['ପରାମର୍ଶ ଅପଡେଟ୍', 'ଆପଣଙ୍କ ପରାମର୍ଶ ବିଷୟରେ ଏକ ଅପଡେଟ୍ ଅଛି।'],
  },
  followup: {
    en: ['Follow-up reminder', 'A follow-up is scheduled for you.'],
    te: ['ఫాలో-అప్ రిమైండర్', 'మీ కోసం ఫాలో-అప్ షెడ్యూల్ చేయబడింది.'],
    hi: ['फॉलो-अप रिमाइंडर', 'आपके लिए फॉलो-अप निर्धारित है।'],
    or: ['ଫଲୋ-ଅପ୍ ସ୍ମାରକ', 'ଆପଣଙ୍କ ପାଇଁ ଫଲୋ-ଅପ୍ ଧାର୍ଯ୍ୟ ହୋଇଛି।'],
  },
  emergency: {
    en: ['Emergency alert', 'An emergency assistance request needs attention.'],
    te: ['అత్యవసర హెచ్చరిక', 'అత్యవసర సహాయం అభ్యర్థనకు శ్రద్ధ అవసరం.'],
    hi: ['आपातकालीन सूचना', 'आपातकालीन सहायता अनुरोध पर ध्यान देना आवश्यक है।'],
    or: ['ଜରୁରୀ ସୂଚନା', 'ଜରୁରୀ ସହାୟତା ଅନୁରୋଧ ପ୍ରତି ଧ୍ୟାନ ଦେବା ଆବଶ୍ୟକ।'],
  },
  registration_confirmation: {
    en: ['Registration confirmed', 'Your demonstration account was registered successfully.'],
    te: ['నమోదు నిర్ధారించబడింది', 'మీ డెమో ఖాతా విజయవంతంగా నమోదు చేయబడింది.'],
    hi: ['पंजीकरण की पुष्टि', 'आपका डेमो खाता सफलतापूर्वक पंजीकृत हुआ।'],
    or: ['ପଞ୍ଜୀକରଣ ନିଶ୍ଚିତ', 'ଆପଣଙ୍କ ଡେମୋ ଖାତା ସଫଳତାର ସହ ପଞ୍ଜୀକୃତ ହୋଇଛି।'],
  },
};

async function localize(db, language, templateKey, title, body) {
  const keys = [`notifications.${templateKey}.title`, `notifications.${templateKey}.body`];
  const rows = await db.collection('translation_contents')
    .find({ language_code: language, key: { $in: keys } }).toArray();
  const translations = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const fallback = typeCopy[templateKey]?.[language] || typeCopy.appointment[language];
  return [
    translations[`notifications.${templateKey}.title`] || title || fallback[0],
    translations[`notifications.${templateKey}.body`] || body || fallback[1],
  ];
}

async function deliver(channel, notification, user) {
  if (channel === 'sms') {
    await smsAdapter.sendSms({
      to: user.mobile,
      message: notification.body,
      idempotencyKey: notification.delivery_key || notification.id,
    });
    return;
  }
  if (channel === 'push') {
    const url = process.env.PUSH_PROVIDER_URL;
    const token = process.env.PUSH_PROVIDER_TOKEN;
    if (!url || !token) return;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': notification.id },
      body: JSON.stringify({ user_id: user.id, message: notification.body }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) logger.error('Notification provider rejected delivery', { channel, notificationId: notification.id, status: response.status });
    return;
  }
  const url = process.env[`${channel.toUpperCase()}_PROVIDER_URL`];
  const token = process.env[`${channel.toUpperCase()}_PROVIDER_TOKEN`];
  if (!url) return;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Idempotency-Key': notification.id,
    },
    body: JSON.stringify({
      channel,
      to: channel === 'sms' ? user.mobile : user.id,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      language: user.preferred_language,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    logger.error('Notification provider rejected delivery', {
      channel,
      notificationId: notification.id,
      status: response.status,
    });
  }
}

async function create(database, userId, templateKey, data = {}, options = {}) {
  if (!userId) return null;
  const db = database && typeof database.collection === 'function' ? database : await getDb();
  const [user, notificationPreferences, preferencesResult] = await Promise.all([
    db.collection('users').findOne({ id: userId }),
    db.collection('notification_preferences').findOne({ user_id: userId }),
    db.collection('user_settings').findOne({ user_id: userId, key: 'notification_preferences' }),
  ]);
  if (!user) return null;
  const [title, body] = await localize(
    db,
    user.preferred_language || 'en',
    templateKey,
    options.title,
    options.body,
  );
  const preferences = preferencesResult?.value || {};
  const emergency = templateKey === 'emergency' || options.type === 'emergency';
  const preferenceType = options.type === 'registration' ? 'registration' : templateKey;
  const enabled = preferences.types?.[preferenceType] !== false;
  const allowedChannels = options.allowedChannels || ['in_app', 'sms', 'push'];
  const quietHours = preferences.quiet_hours;
  const currentTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  const isQuiet = quietHours?.enabled && (
    quietHours.start <= quietHours.end
      ? currentTime >= quietHours.start && currentTime < quietHours.end
      : currentTime >= quietHours.start || currentTime < quietHours.end
  );
  const channels = [];
  if (emergency || (allowedChannels.includes('in_app') && enabled && notificationPreferences?.in_app_enabled !== false && preferences.channels?.in_app !== false)) channels.push('in_app');
  if ((!isQuiet || emergency) && allowedChannels.includes('sms') && notificationPreferences?.sms_enabled && preferences.channels?.sms !== false && user.mobile && (enabled || emergency)) channels.push('sms');
  if ((!isQuiet || emergency) && allowedChannels.includes('push') && notificationPreferences?.push_enabled && preferences.channels?.push !== false && (enabled || emergency)) channels.push('push');
  if (!channels.length) return null;
  const deliveryKey = options.idempotencyKey || createHash('sha256')
    .update(`${userId}:${options.type || templateKey}:${JSON.stringify(data)}`)
    .digest('hex');
  let notification = {
    id: randomUUID(),
    user_id: userId,
    delivery_key: deliveryKey,
    notification_type: options.type || templateKey,
    title,
    body,
    data,
    read_at: null,
    is_read: false,
    created_at: new Date(),
  };
  if (channels.includes('in_app')) {
    const collection = db.collection('notifications');
    let existing = deliveryKey ? await collection.findOne({ user_id: userId, delivery_key: deliveryKey }) : null;
    if (!existing) {
      await collection.insertOne(notification);
      existing = notification;
    }
    notification = { ...existing };
    delete notification._id;
  }
  for (const channel of channels.filter((item) => item !== 'in_app')) {
    try {
      await deliver(channel, notification, { ...user, id: userId });
    } catch (error) {
      logger.error('Notification delivery failed', {
        channel,
        notificationId: notification.id,
        error: error.message,
      });
    }
  }
  return notification;
}

async function createStandalone(userId, templateKey, data = {}, options = {}) {
  return create(null, userId, templateKey, data, options);
}

module.exports = { create, createStandalone };
