const { randomUUID } = require('node:crypto');
const { getDb } = require('../db/mongo');
const notificationService = require('../services/notificationService');

const copy = {
  en: (name, time) => `It is time to take ${name} (${time}). Please follow your clinician's instructions.`,
  te: (name, time) => `${name} మందు వేసుకునే సమయం (${time}). వైద్యుని సూచనలను అనుసరించండి.`,
  hi: (name, time) => `${name} लेने का समय (${time}) है। कृपया अपने चिकित्सक के निर्देशों का पालन करें।`,
  or: (name, time) => `${name} ଖାଇବା ସମୟ (${time}) ହୋଇଛି। ଦୟାକରି ଡାକ୍ତରଙ୍କ ପରାମର୍ଶ ମାନନ୍ତୁ।`,
};

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function localTime(instant) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

function localTimestamp(date, time) {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}

function dateOffset(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function extendReminder(db, reminder, today) {
  const generated = reminder.generated_until
    ? new Date(reminder.generated_until).toISOString().slice(0, 10)
    : null;
  const from = generated ? dateOffset(generated, 1) : today;
  const start = from > today ? from : today;
  let through = dateOffset(today, 6);
  if (reminder.ends_at) {
    const endDate = localDate(new Date(reminder.ends_at));
    if (endDate < through) through = endDate;
  }
  if (start > through) return;
  const logs = db.collection('medication_logs');
  for (let date = start; date <= through; date = dateOffset(date, 1)) {
    for (const time of reminder.reminder_times || []) {
      const scheduledFor = new Date(localTimestamp(date, time));
      if (scheduledFor < new Date(reminder.starts_at)) continue;
      if (reminder.ends_at && scheduledFor > new Date(reminder.ends_at)) continue;
      await logs.updateOne(
        { reminder_id: reminder.id, scheduled_for: scheduledFor },
        {
          $setOnInsert: {
            id: randomUUID(),
            reminder_id: reminder.id,
            scheduled_for: scheduledFor,
            status: 'pending',
            sent_at: null,
            created_at: new Date(),
          },
        },
        { upsert: true },
      );
    }
  }
  await db.collection('medicine_reminders').updateOne(
    { id: reminder.id },
    { $set: { generated_until: through, updated_at: new Date() } },
  );
}

async function dispatchMedicineReminders(now = new Date()) {
  const db = await getDb();
  const [reminders, patients] = await Promise.all([
    db.collection('medicine_reminders').find({
      is_active: true,
      $or: [{ ends_at: null }, { ends_at: { $gte: now } }],
    }).toArray(),
    db.collection('patients').find({ is_active: true }).toArray(),
  ]);
  const patientMap = new Map(patients.map((patient) => [patient.id, patient]));
  const today = localDate(now);
  let count = 0;
  for (const reminder of reminders) {
    if (patientMap.has(reminder.patient_id)) await extendReminder(db, reminder, today);
  }
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  await db.collection('medication_logs').updateMany(
    { status: 'pending', scheduled_for: { $lt: cutoff } },
    { $set: { status: 'missed', updated_at: now } },
  );
  const due = await db.collection('medication_logs').find({
    status: 'pending',
    sent_at: null,
    scheduled_for: { $lte: now },
  }).sort({ scheduled_for: 1 }).toArray();
  const reminderMap = new Map(reminders.map((item) => [item.id, item]));
  const medicineIds = [...new Set(reminders.map((item) => item.medicine_id))];
  const medicines = await db.collection('medicines').find({ id: { $in: medicineIds } }).toArray();
  const medicineMap = new Map(medicines.map((item) => [item.id, item]));
  const userIds = [...new Set(patients.map((patient) => patient.user_id).filter(Boolean))];
  const users = await db.collection('users').find({ id: { $in: userIds } }).toArray();
  const userMap = new Map(users.map((item) => [item.id, item]));
  for (const dose of due) {
    const reminder = reminderMap.get(dose.reminder_id);
    const patient = reminder && patientMap.get(reminder.patient_id);
    const medicine = reminder && medicineMap.get(reminder.medicine_id);
    if (!reminder || !patient || !medicine || !patient.user_id) continue;
    const user = userMap.get(patient.user_id);
    const language = copy[user?.preferred_language || patient.preferred_language]
      ? user?.preferred_language || patient.preferred_language
      : 'en';
    const message = copy[language](medicine.name, localTime(new Date(dose.scheduled_for)));
    const allowedChannels = reminder.channel === 'all' ? ['in_app', 'sms', 'push'] : [reminder.channel];
    await notificationService.create(
      db,
      patient.user_id,
      'medicine',
      { medication_log_id: dose.id, reminder_id: reminder.id },
      {
        type: 'medicine',
        title: language === 'te' ? 'మందు గుర్తుచూపు' : language === 'hi' ? 'दवा अनुस्मारक' : language === 'or' ? 'ଔଷଧ ସ୍ମାରକ' : 'Medicine reminder',
        body: message,
        allowedChannels,
        idempotencyKey: `aarogya-medicine-${dose.id}`,
      },
    );
    await db.collection('medication_logs').updateOne(
      { id: dose.id, status: 'pending', sent_at: null },
      { $set: { sent_at: now, updated_at: now } },
    );
    count += 1;
  }
  return { notifications_sent: count };
}

module.exports = { dispatchMedicineReminders, localDate, localTimestamp };
