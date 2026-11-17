const { randomUUID } = require('node:crypto');
const { getDb } = require('../db/mongo');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function pageArgs(query) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw httpError(400, 'INVALID_PAGINATION', 'page must be positive and limit must be between 1 and 100');
  }
  return { page, limit, offset: (page - 1) * limit };
}

async function audit(db, req, action, entity, entityId, metadata = {}) {
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: req.user.sub,
    action,
    entity,
    entity_id: entityId,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata,
    created_at: new Date(),
  });
}

async function patientForActor(db, patientId, user, { allowHealthWorker = true } = {}) {
  const patient = await db.collection('patients').findOne({ id: patientId, is_active: true });
  if (!patient) throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
  if (user.role === 'patient') {
    if (patient.user_id !== user.sub) throw httpError(403, 'FORBIDDEN', 'You can only access your own medicine records');
  } else if (user.role === 'health_worker' && allowHealthWorker) {
    const assigned = await db.collection('health_workers').findOne({
      user_id: user.sub,
      $or: [
        ...(patient.phc_id ? [{ phc_id: patient.phc_id }] : []),
        ...(patient.village_id ? [{ village_id: patient.village_id }] : []),
      ],
    });
    if (!assigned) throw httpError(403, 'OUTSIDE_ASSIGNED_AREA', 'Patient is outside your assigned area');
  } else if (user.role === 'doctor') {
    const doctor = await db.collection('doctors').findOne({ user_id: user.sub });
    const appointment = await db.collection('appointments').findOne({
      doctor_id: doctor?.id,
      patient_id: patient.id,
    });
    if (!doctor || (!(doctor.phc_id && doctor.phc_id === patient.phc_id) && !appointment)) {
      throw httpError(403, 'PATIENT_NOT_ASSIGNED', 'Patient is not assigned to this doctor');
    }
  } else if (user.role === 'specialist') {
    const specialist = await db.collection('specialists').findOne({ user_id: user.sub });
    const referral = specialist && await db.collection('referrals').findOne({
      referred_to_specialist_id: specialist.id,
      patient_id: patient.id,
      status: { $ne: 'rejected' },
    });
    if (!referral) throw httpError(403, 'PATIENT_NOT_REFERRED', 'Patient is not referred to this specialist');
  }
  return patient;
}

async function patientInScope(db, patient, user) {
  if (!patient?.is_active) return false;
  if (user.role === 'patient') return patient.user_id === user.sub;
  if (user.role === 'health_worker') {
    return Boolean(await db.collection('health_workers').findOne({
      user_id: user.sub,
      $or: [
        ...(patient.phc_id ? [{ phc_id: patient.phc_id }] : []),
        ...(patient.village_id ? [{ village_id: patient.village_id }] : []),
      ],
    }));
  }
  if (user.role === 'doctor') {
    const doctor = await db.collection('doctors').findOne({ user_id: user.sub });
    if (!doctor) return false;
    if (doctor.phc_id === patient.phc_id) return true;
    return Boolean(await db.collection('appointments').findOne({ doctor_id: doctor.id, patient_id: patient.id }));
  }
  if (user.role === 'specialist') {
    const specialist = await db.collection('specialists').findOne({ user_id: user.sub });
    return Boolean(specialist && await db.collection('referrals').findOne({
      referred_to_specialist_id: specialist.id,
      patient_id: patient.id,
      status: { $ne: 'rejected' },
    }));
  }
  return true;
}

async function assertPatientFilter(query, user) {
  if (!query.patient_id || ['admin', 'super_admin'].includes(user.role)) return;
  const db = await getDb();
  await patientForActor(db, query.patient_id, user);
}

async function createMedicine(body, user, req) {
  const db = await getDb();
  await patientForActor(db, body.patient_id, user);
  const now = new Date();
  const medicine = {
    id: randomUUID(),
    medicine_code: `MED-${randomUUID()}`,
    patient_id: body.patient_id,
    name: body.name,
    dosage: body.dosage,
    form: body.form,
    instructions: body.instructions || '',
    prescribed_by: user.role === 'doctor' ? user.sub : null,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  await db.collection('medicines').insertOne(medicine);
  await audit(db, req, 'medicine.created', 'medicine', medicine.id, { patient_id: body.patient_id });
  return {
    data: {
      medicine: {
        id: medicine.id,
        medicine_code: medicine.medicine_code,
        patient_id: medicine.patient_id,
        name: medicine.name,
        dosage: medicine.dosage,
        form: medicine.form,
        instructions: medicine.instructions,
        prescribed_by: medicine.prescribed_by,
        is_active: medicine.is_active,
        created_at: medicine.created_at,
      },
    },
  };
}

async function medicinePatientLinks(db, medicine) {
  const reminders = await db.collection('medicine_reminders').find({ medicine_id: medicine.id }).toArray();
  const patientIds = [...new Set([medicine.patient_id, ...reminders.map((item) => item.patient_id)].filter(Boolean))];
  const patients = [];
  for (const id of patientIds) {
    const patient = await db.collection('patients').findOne({ id });
    if (patient) patients.push(patient);
  }
  return { reminders, patients, associated_patient_id: medicine.patient_id || reminders[0]?.patient_id };
}

async function listMedicines(query, user) {
  await assertPatientFilter(query, user);
  const db = await getDb();
  const { page, limit, offset } = pageArgs(query);
  const isActive = query.is_active === undefined ? null : query.is_active === 'true';
  const medicines = await db.collection('medicines').find(
    isActive === null ? {} : { is_active: isActive },
  ).sort({ created_at: -1 }).toArray();
  const filtered = [];
  for (const medicine of medicines) {
    const links = await medicinePatientLinks(db, medicine);
    if (query.search && !medicine.name?.toLowerCase().includes(query.search.toLowerCase())) continue;
    if (query.patient_id && !links.patients.some((patient) => patient.id === query.patient_id)) continue;
    let allowed;
    if (user.role === 'patient') {
      allowed = links.patients.some((patient) => patient.user_id === user.sub);
    } else if (['admin', 'super_admin'].includes(user.role)) {
      allowed = true;
    } else {
      allowed = false;
      for (const patient of links.patients) {
        if (await patientInScope(db, patient, user)) {
          allowed = true;
          break;
        }
      }
    }
    if (!allowed) continue;
    filtered.push({
      id: medicine.id,
      medicine_code: medicine.medicine_code,
      patient_id: medicine.patient_id,
      name: medicine.name,
      dosage: medicine.dosage,
      form: medicine.form,
      instructions: medicine.instructions,
      prescribed_by: medicine.prescribed_by,
      is_active: medicine.is_active,
      created_at: medicine.created_at,
      associated_patient_id: links.associated_patient_id,
    });
  }
  const total = filtered.length;
  return {
    data: { items: filtered.slice(offset, offset + limit) },
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function reminderSchedule(startDate, endDate, times, now = new Date()) {
  const firstDate = localDate(now);
  const first = new Date(`${firstDate}T00:00:00.000Z`);
  const last = new Date(first);
  last.setUTCDate(last.getUTCDate() + 6);
  let finalDate = last.toISOString().slice(0, 10);
  if (endDate && endDate < finalDate) finalDate = endDate;
  const end = endDate ? new Date(`${endDate}T23:59:59.999+05:30`) : null;
  const lastDay = new Date(`${finalDate}T00:00:00.000Z`);
  const logTimes = [];
  for (const day = new Date(first); day <= lastDay; day.setUTCDate(day.getUTCDate() + 1)) {
    const datePart = day.toISOString().slice(0, 10);
    for (const time of times) {
      const scheduled = new Date(`${datePart}T${time}:00+05:30`);
      const start = new Date(`${startDate}T00:00:00.000+05:30`);
      if (scheduled >= now && scheduled >= start && (!end || scheduled <= end)) logTimes.push(scheduled.toISOString());
    }
  }
  return {
    logTimes,
    generatedUntil: finalDate,
    startsAt: new Date(`${startDate}T00:00:00.000+05:30`).toISOString(),
    endsAt: end?.toISOString() || null,
  };
}

async function createReminder(body, user, req) {
  const db = await getDb();
  const medicine = await db.collection('medicines').findOne({ id: body.medicine_id, is_active: true });
  if (!medicine) throw httpError(404, 'MEDICINE_NOT_FOUND', 'Medicine not found');
  const links = await medicinePatientLinks(db, medicine);
  const patientId = medicine.patient_id || links.reminders[0]?.patient_id;
  if (!patientId) throw httpError(404, 'MEDICINE_NOT_FOUND', 'Medicine not found');
  const patient = await patientForActor(db, patientId, user);
  if (!medicine.patient_id) {
    await db.collection('medicines').updateOne({ id: medicine.id }, {
      $set: { patient_id: patient.id, updated_at: new Date() },
    });
  }
  if (body.end_date && body.end_date < localDate()) {
    throw httpError(422, 'REMINDER_END_DATE_PASSED', 'end_date must not be in the past');
  }
  const schedule = reminderSchedule(body.start_date, body.end_date, body.reminder_times);
  const now = new Date();
  const reminder = {
    id: randomUUID(),
    patient_id: patient.id,
    medicine_id: medicine.id,
    prescribed_by: medicine.prescribed_by || null,
    dosage: medicine.dosage,
    instructions: medicine.instructions,
    starts_at: new Date(schedule.startsAt),
    ends_at: schedule.endsAt ? new Date(schedule.endsAt) : null,
    schedule: { times: body.reminder_times },
    frequency: body.frequency,
    reminder_times: body.reminder_times,
    channel: body.channel,
    is_active: true,
    generated_until: schedule.generatedUntil,
    created_at: now,
    updated_at: now,
  };
  await db.collection('medicine_reminders').insertOne(reminder);
  for (const scheduledFor of schedule.logTimes) {
    await db.collection('medication_logs').updateOne(
      { reminder_id: reminder.id, scheduled_for: new Date(scheduledFor) },
      {
        $setOnInsert: {
          id: randomUUID(),
          reminder_id: reminder.id,
          scheduled_for: new Date(scheduledFor),
          status: 'pending',
          notes: '',
          sent_at: null,
          logged_at: null,
          created_at: now,
          updated_at: now,
        },
      },
      { upsert: true },
    );
  }
  await audit(db, req, 'medicine_reminder.created', 'medicine_reminder', reminder.id, { patient_id: patient.id });
  return {
    data: {
      reminder: {
        id: reminder.id,
        patient_id: reminder.patient_id,
        medicine_id: reminder.medicine_id,
        dosage: reminder.dosage,
        instructions: reminder.instructions,
        starts_at: reminder.starts_at,
        ends_at: reminder.ends_at,
        frequency: reminder.frequency,
        reminder_times: reminder.reminder_times,
        channel: reminder.channel,
        is_active: reminder.is_active,
      },
    },
  };
}

function dateStart(date) {
  return new Date(`${date}T00:00:00+05:30`);
}

function dateEnd(date) {
  const end = dateStart(date);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

async function listReminders(query, user) {
  await assertPatientFilter(query, user);
  const db = await getDb();
  const { page, limit, offset } = pageArgs(query);
  const reminders = await db.collection('medicine_reminders').find({}).toArray();
  const items = [];
  for (const reminder of reminders) {
    const patient = await db.collection('patients').findOne({ id: reminder.patient_id });
    const medicine = await db.collection('medicines').findOne({ id: reminder.medicine_id });
    if (!patient || !medicine) continue;
    if (user.role === 'patient' && patient.user_id !== user.sub) continue;
    if (query.patient_id && reminder.patient_id !== query.patient_id) continue;
    if (query.status && reminder.is_active !== (query.status === 'active')) continue;
    if (user.role !== 'patient' && !['admin', 'super_admin'].includes(user.role) &&
      !await patientInScope(db, patient, user)) continue;
    if (query.from && reminder.ends_at && new Date(reminder.ends_at) < dateStart(query.from)) continue;
    if (query.to && new Date(reminder.starts_at) >= dateEnd(query.to)) continue;
    const nextDose = await db.collection('medication_logs').find({
      reminder_id: reminder.id,
      status: 'pending',
      scheduled_for: { $gte: new Date() },
    }).sort({ scheduled_for: 1 }).limit(1).next();
    items.push({
      id: reminder.id,
      patient_id: reminder.patient_id,
      medicine_id: reminder.medicine_id,
      medicine_name: medicine.name,
      dosage: reminder.dosage,
      instructions: reminder.instructions,
      frequency: reminder.frequency,
      reminder_times: reminder.reminder_times,
      starts_at: reminder.starts_at,
      ends_at: reminder.ends_at,
      channel: reminder.channel,
      is_active: reminder.is_active,
      next_dose_at: nextDose?.scheduled_for || null,
    });
  }
  items.sort((left, right) => Number(right.is_active) - Number(left.is_active) ||
    new Date(right.starts_at) - new Date(left.starts_at));
  const total = items.length;
  return {
    data: { items: items.slice(offset, offset + limit) },
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function createLog(body, user, req) {
  const db = await getDb();
  const scheduledFor = new Date(body.scheduled_for);
  const log = await db.collection('medication_logs').findOne({
    reminder_id: body.reminder_id,
    scheduled_for: scheduledFor,
  });
  if (!log) throw httpError(404, 'DOSE_NOT_FOUND', 'Scheduled medicine dose was not found');
  const reminder = await db.collection('medicine_reminders').findOne({ id: log.reminder_id });
  const patient = reminder && await db.collection('patients').findOne({ id: reminder.patient_id });
  if (!reminder || !patient) throw httpError(404, 'DOSE_NOT_FOUND', 'Scheduled medicine dose was not found');
  if (user.role === 'patient' && patient.user_id !== user.sub) {
    throw httpError(403, 'FORBIDDEN', 'You can only update your own medicine log');
  }
  if (user.role === 'doctor') await patientForActor(db, patient.id, user);
  if (log.status === 'pending') {
    const updated = await db.collection('medication_logs').findOneAndUpdate(
      { id: log.id, status: 'pending' },
      {
        $set: {
          status: body.status,
          notes: body.notes,
          logged_at: new Date(),
          updated_at: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      const latest = await db.collection('medication_logs').findOne({ id: log.id });
      if (latest?.status !== body.status) {
        throw httpError(409, 'DOSE_ALREADY_RECORDED', 'This dose has already been recorded with a different status');
      }
      return { data: { log: logResponse(latest) } };
    }
    await audit(db, req, 'medicine_log.recorded', 'medication_log', log.id, { status: body.status });
    return { data: { log: logResponse(updated) } };
  }
  if (log.status !== body.status) {
    throw httpError(409, 'DOSE_ALREADY_RECORDED', 'This dose has already been recorded with a different status');
  }
  return { data: { log: logResponse(log) } };
}

function logResponse(log) {
  return {
    id: log.id,
    reminder_id: log.reminder_id,
    scheduled_for: log.scheduled_for,
    status: log.status,
    notes: log.notes,
    logged_at: log.logged_at,
  };
}

async function listLogs(query, user) {
  await assertPatientFilter(query, user);
  const db = await getDb();
  const { page, limit, offset } = pageArgs(query);
  const logs = await db.collection('medication_logs').find({}).toArray();
  const items = [];
  const adherenceLogs = [];
  for (const log of logs) {
    const reminder = await db.collection('medicine_reminders').findOne({ id: log.reminder_id });
    const patient = reminder && await db.collection('patients').findOne({ id: reminder.patient_id });
    const medicine = reminder && await db.collection('medicines').findOne({ id: reminder.medicine_id });
    if (!reminder || !patient || !medicine) continue;
    adherenceLogs.push({ ...log, medicine_id: reminder.medicine_id, medicine_name: medicine.name, patient });
    if (user.role === 'patient' && patient.user_id !== user.sub) continue;
    if (query.patient_id && patient.id !== query.patient_id) continue;
    if (query.medicine_id && reminder.medicine_id !== query.medicine_id) continue;
    if (query.status && log.status !== query.status) continue;
    if (query.from && new Date(log.scheduled_for) < dateStart(query.from)) continue;
    if (query.to && new Date(log.scheduled_for) >= dateEnd(query.to)) continue;
    if (user.role !== 'patient' && !['admin', 'super_admin'].includes(user.role) &&
      !await patientInScope(db, patient, user)) continue;
    const row = {
      id: log.id,
      reminder_id: log.reminder_id,
      scheduled_for: log.scheduled_for,
      status: log.status,
      notes: log.notes,
      sent_at: log.sent_at,
      logged_at: log.logged_at,
      patient_id: reminder.patient_id,
      medicine_id: reminder.medicine_id,
      medicine_name: medicine.name,
      dosage: reminder.dosage,
      instructions: reminder.instructions,
    };
    items.push(row);
  }
  items.sort((left, right) => new Date(right.scheduled_for) - new Date(left.scheduled_for));
  const total = items.length;
  let summary;
  if (query.summary === 'true') {
    const summaryGroups = new Map();
    for (const log of adherenceLogs) {
      if (!['taken', 'missed'].includes(log.status)) continue;
      if (user.role === 'patient' && log.patient.user_id !== user.sub) continue;
      if (query.patient_id && log.patient.id !== query.patient_id) continue;
      if (user.role !== 'patient' && !['admin', 'super_admin'].includes(user.role) &&
        !await patientInScope(db, log.patient, user)) continue;
      const key = log.medicine_id;
      if (!summaryGroups.has(key)) summaryGroups.set(key, []);
      summaryGroups.get(key).push(log);
    }
    summary = [...summaryGroups.entries()].map(([medicineId, medicineLogs]) => {
      const now = Date.now();
      const taken = medicineLogs.filter((log) => log.status === 'taken').length;
      const missed = medicineLogs.filter((log) => log.status === 'missed').length;
      const completed = taken + missed;
      const weekly = medicineLogs.filter((log) => new Date(log.scheduled_for).getTime() >= now - 7 * 86400000);
      const monthly = medicineLogs.filter((log) => new Date(log.scheduled_for).getTime() >= now - 30 * 86400000);
      const weeklyTaken = weekly.filter((log) => log.status === 'taken').length;
      const monthlyTaken = monthly.filter((log) => log.status === 'taken').length;
      medicineLogs.sort((left, right) => new Date(right.scheduled_for) - new Date(left.scheduled_for));
      let currentStreak = 0;
      for (const log of medicineLogs) {
        if (log.status === 'missed') break;
        currentStreak += 1;
      }
      return {
        medicine_id: medicineId,
        medicine_name: medicineLogs[0].medicine_name,
        taken,
        missed,
        completed,
        weekly_taken: weeklyTaken,
        weekly_completed: weekly.length,
        monthly_taken: monthlyTaken,
        monthly_completed: monthly.length,
        adherence_percent: completed ? Math.round((taken / completed) * 100) : null,
        weekly_adherence_percent: weekly.length ? Math.round((weeklyTaken / weekly.length) * 100) : null,
        monthly_adherence_percent: monthly.length ? Math.round((monthlyTaken / monthly.length) * 100) : null,
        current_streak: currentStreak,
      };
    });
  }
  return {
    data: { items: items.slice(offset, offset + limit), ...(summary ? { adherence: summary } : {}) },
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

module.exports = {
  createMedicine,
  listMedicines,
  createReminder,
  listReminders,
  createLog,
  listLogs,
  httpError,
  pageArgs,
  reminderSchedule,
};
