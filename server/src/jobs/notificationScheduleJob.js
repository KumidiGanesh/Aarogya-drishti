const { getDb } = require('../db/mongo');
const notifications = require('../services/notificationService');
const logger = require('../utils/logger');

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function dispatchScheduledNotifications(now = new Date()) {
  const db = await getDb();
  let sent = 0;
  try {
    const consultations = await db.collection('consultations').find({
      status: { $ne: 'cancelled' },
    }).sort({ created_at: 1 }).toArray();
    const appointmentIds = [...new Set(consultations.map((item) => item.appointment_id).filter(Boolean))];
    const patientIds = [...new Set(consultations.map((item) => item.patient_id).filter(Boolean))];
    const doctorIds = [...new Set(consultations.map((item) => item.doctor_id).filter(Boolean))];
    const [appointments, patients, doctors] = await Promise.all([
      db.collection('appointments').find({ id: { $in: appointmentIds } }).toArray(),
      db.collection('patients').find({ id: { $in: patientIds } }).toArray(),
      db.collection('doctors').find({ user_id: { $in: doctorIds } }).toArray(),
    ]);
    const appointmentMap = new Map(appointments.map((item) => [item.id, item]));
    const patientMap = new Map(patients.map((item) => [item.id, item]));
    const doctorMap = new Map(doctors.map((item) => [item.id, item]));
    for (const consultation of consultations) {
      const appointment = appointmentMap.get(consultation.appointment_id);
      const patient = patientMap.get(consultation.patient_id);
      const doctor = doctorMap.get(consultation.doctor_id);
      const patientUserId = patient?.user_id;
      const doctorUserId = doctor?.user_id;
      const appointmentTime = appointment?.scheduled_at ? new Date(appointment.scheduled_at).getTime() : NaN;
      const currentTime = now.getTime();
      for (const [reminder, minutes, sentField] of [
        ['30m', 30, 'reminder_30m_sent_at'],
        ['10m', 10, 'reminder_10m_sent_at'],
      ]) {
        if (consultation[sentField] || !Number.isFinite(appointmentTime)
          || appointmentTime <= currentTime || appointmentTime > currentTime + minutes * 60 * 1000) continue;
        const data = { consultation_id: consultation.id, reminder };
        for (const participantId of [patientUserId, doctorUserId].filter(Boolean)) {
          await notifications.create(db, participantId, 'consultation', data, { type: 'consultation' });
        }
        await db.collection('consultations').updateOne(
          { id: consultation.id, [sentField]: null },
          { $set: { [sentField]: now, updated_at: now } },
        );
        sent += 1;
      }
      if (consultation.follow_up_at && !consultation.follow_up_reminder_sent_at) {
        const followUpTime = new Date(consultation.follow_up_at).getTime();
        if (followUpTime > currentTime && followUpTime <= currentTime + 24 * 60 * 60 * 1000) {
          await notifications.create(db, patientUserId, 'followup', {
            consultation_id: consultation.id,
            recommendation: consultation.follow_up_recommendation,
          }, { type: 'followup' });
          await db.collection('consultations').updateOne(
            { id: consultation.id, follow_up_reminder_sent_at: null },
            { $set: { follow_up_reminder_sent_at: now, updated_at: now } },
          );
          sent += 1;
        }
      }
    }

    const today = localDate(now);
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowString = tomorrow.toISOString().slice(0, 10);
    const followUps = await db.collection('referral_events').find({
      event_type: 'follow_up',
      'details.reminder_sent_at': null,
      'details.follow_up_date': { $gte: today, $lte: tomorrowString },
    }).sort({ created_at: 1 }).limit(100).toArray();
    const referralIds = [...new Set(followUps.map((item) => item.referral_id))];
    const referrals = await db.collection('referrals').find({ id: { $in: referralIds } }).toArray();
    const referralMap = new Map(referrals.map((item) => [item.id, item]));
    const followPatientIds = [...new Set(referrals.map((item) => item.patient_id))];
    const followPatients = await db.collection('patients').find({ id: { $in: followPatientIds } }).toArray();
    const followPatientMap = new Map(followPatients.map((item) => [item.id, item]));
    for (const followUp of followUps) {
      const referral = referralMap.get(followUp.referral_id);
      const patient = referral && followPatientMap.get(referral.patient_id);
      if (!patient?.user_id) continue;
      await notifications.create(db, patient.user_id, 'followup', {
        referral_id: followUp.referral_id,
        ...followUp.details,
      }, { type: 'followup' });
      await db.collection('referral_events').updateOne(
        { id: followUp.id, 'details.reminder_sent_at': null },
        { $set: { 'details.reminder_sent_at': now, updated_at: now } },
      );
      sent += 1;
    }
    return { notifications_sent: sent };
  } catch (error) {
    logger.error('Scheduled notification dispatch failed', { error: error.message });
    throw error;
  }
}

module.exports = { dispatchScheduledNotifications };
