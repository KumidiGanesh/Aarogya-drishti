const { randomUUID } = require('node:crypto');
const { getDb } = require('../db/mongo');
const getNotificationCopy = require('../notifications/phase8Copy');
const notificationService = require('../services/notificationService');
const {
  FACILITY_NAMES,
  HOSPITAL_NAMES,
  PRIMARY_CARE_NAMES,
  CHC_NAME,
} = require('../facilities/catalog');

const ACTIVE_STATUSES = ['booked', 'confirmed', 'rescheduled'];
let activeSlotIndexPromise;

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

function audit(db, req, appointmentId, action, metadata = {}) {
  return db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: req.user.sub,
    action,
    entity: 'appointment',
    entity_id: appointmentId,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata,
    created_at: new Date(),
  });
}

async function notify(db, userId, type, title, body, data) {
  if (!userId) return;
  const user = await db.collection('users').findOne({ id: userId });
  if (!user) return;
  const [localizedTitle, localizedBody] = getNotificationCopy(user.preferred_language, type);
  await notificationService.create(db, userId, 'appointment', data, {
    type: 'appointment',
    title: localizedTitle || title,
    body: localizedBody || body,
  });
}

async function patientAssignment(db, patient, user) {
  if (user.role !== 'health_worker') return;
  const assignment = await db.collection('health_workers').findOne({
    user_id: user.sub,
    $or: [
      ...(patient.phc_id ? [{ phc_id: patient.phc_id }] : []),
      ...(patient.village_id ? [{ village_id: patient.village_id }] : []),
    ],
  });
  if (!assignment) throw httpError(403, 'OUTSIDE_ASSIGNED_AREA', 'Patient is outside your assigned area');
}

async function getDoctor(db, doctorId, facilityType, facilityId) {
  const doctor = await db.collection('doctors').findOne({ id: doctorId });
  const user = doctor && await db.collection('users').findOne({ id: doctor.user_id });
  const doctorFacility = doctor?.[facilityType === 'hospital' ? 'hospital_id' : 'phc_id'];
  if (!doctor || !user?.is_active || doctorFacility !== facilityId) {
    throw httpError(422, 'DOCTOR_FACILITY_MISMATCH', 'The doctor does not work at the selected facility');
  }
  return { ...doctor, user_id: user.id, is_active: user.is_active };
}

function appointmentInstant(date, slot) {
  return new Date(`${date}T${slot}:00+05:30`);
}

function availabilityDay(date) {
  return String(new Date(`${date}T00:00:00Z`).getUTCDay());
}

async function ensureActiveSlotIndex(db) {
  const appointments = db.collection('appointments');
  if (typeof appointments.createIndex !== 'function') return;
  if (!activeSlotIndexPromise) {
    activeSlotIndexPromise = appointments.createIndex(
      { doctor_id: 1, scheduled_at: 1 },
      {
        name: 'idx_appointments_active_doctor_slot',
        unique: true,
        partialFilterExpression: { deleted_at: null, status: { $in: ACTIVE_STATUSES } },
      },
    ).catch((error) => {
      activeSlotIndexPromise = undefined;
      throw error;
    });
  }
  await activeSlotIndexPromise;
}

async function validateSlot(db, doctorId, facilityType, facilityId, date, slot, excludeId) {
  await ensureActiveSlotIndex(db);
  const facilities = db.collection(facilityType === 'hospital' ? 'hospitals' : 'phcs');
  const facility = await facilities.findOne({ id: facilityId, is_active: true });
  if (!facility) throw httpError(404, 'FACILITY_NOT_FOUND', 'The selected facility is not active or does not exist');
  const allowedNames = facilityType === 'hospital' ? HOSPITAL_NAMES : PRIMARY_CARE_NAMES;
  if (!allowedNames.includes(facility.name)) {
    throw httpError(422, 'FACILITY_NOT_ALLOWED', 'The selected facility is not in the appointment directory');
  }
  const doctor = await getDoctor(db, doctorId, facilityType, facilityId);
  const times = doctor.availability?.[availabilityDay(date)] || [];
  if (!times.includes(slot)) throw httpError(422, 'SLOT_OUTSIDE_AVAILABILITY', 'The selected time is outside the doctor availability');
  const scheduledAt = appointmentInstant(date, slot);
  if (scheduledAt <= new Date()) throw httpError(422, 'APPOINTMENT_IN_PAST', 'Appointment date and time must be in the future');
  const existing = await db.collection('appointments').findOne({
    doctor_id: doctorId,
    scheduled_at: scheduledAt,
    deleted_at: null,
    status: { $in: ACTIVE_STATUSES },
    ...(excludeId ? { id: { $ne: excludeId } } : {}),
  });
  if (existing) throw httpError(409, 'APPOINTMENT_SLOT_TAKEN', 'That appointment slot is already booked');
  return scheduledAt;
}

async function setPreferences(db, userId, preferences) {
  await db.collection('user_settings').updateOne(
    { user_id: userId, key: 'appointment_reminders' },
    { $set: { value: preferences, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true },
  );
}

async function createAppointment(input, user, req) {
  const db = await getDb();
  const facilityType = input.hospital_id ? 'hospital' : 'phc';
  const facilityId = input.hospital_id || input.phc_id;
  const patient = await db.collection('patients').findOne({ id: input.patient_id });
  if (!patient || !patient.is_active || patient.deleted_at) {
    throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
  }
  if (user.role === 'patient' && patient.user_id !== user.sub) {
    throw httpError(403, 'FORBIDDEN', 'You may only book appointments for yourself');
  }
  await patientAssignment(db, patient, user);
  const scheduledAt = await validateSlot(
    db, input.doctor_id, facilityType, facilityId, input.appointment_date, input.time_slot,
  );
  const now = new Date();
  const appointment = {
    id: randomUUID(),
    patient_id: patient.id,
    doctor_id: input.doctor_id,
    facility_type: facilityType,
    facility_id: facilityId,
    scheduled_at: scheduledAt,
    status: 'booked',
    reason: input.reason,
    mode: input.mode,
    time_slot: input.time_slot,
    deleted_at: null,
    cancel_reason: '',
    reminder_24h_sent_at: null,
    reminder_2h_sent_at: null,
    created_at: now,
    updated_at: now,
  };
  try {
    await db.collection('appointments').insertOne(appointment);
  } catch (error) {
    if (error.code === 11000) throw httpError(409, 'APPOINTMENT_SLOT_TAKEN', 'That appointment slot is already booked');
    throw error;
  }
  const doctor = await getDoctor(db, input.doctor_id, facilityType, facilityId);
  await notify(db, patient.user_id, 'appointment_requested', 'Appointment request received',
    'Your appointment request is awaiting facility confirmation.',
    { appointment_id: appointment.id, scheduled_at: appointment.scheduled_at });
  await notify(db, doctor.user_id, 'appointment_requested', 'Appointment request received',
    'A patient appointment request is awaiting facility confirmation.',
    { appointment_id: appointment.id, scheduled_at: appointment.scheduled_at });
  if (input.reminder_preferences && patient.user_id) {
    await setPreferences(db, patient.user_id, input.reminder_preferences);
  }
  await audit(db, req, appointment.id, 'appointment.created', {
    patient_id: patient.id, doctor_id: input.doctor_id, facility_type: facilityType, facility_id: facilityId,
  });
  return {
    id: appointment.id,
    patient_id: appointment.patient_id,
    doctor_id: appointment.doctor_id,
    facility_type: appointment.facility_type,
    facility_id: appointment.facility_id,
    scheduled_at: appointment.scheduled_at,
    status: appointment.status,
    reason: appointment.reason,
    mode: appointment.mode,
    time_slot: appointment.time_slot,
    created_at: appointment.created_at,
  };
}

async function directory(db) {
  const [doctors, hospitals, phcs] = await Promise.all([
    db.collection('doctors').find({}).toArray(),
    db.collection('hospitals')
      .find({ is_active: true, name: { $in: HOSPITAL_NAMES } }, { projection: { id: 1, name: 1, _id: 0 } })
      .toArray(),
    db.collection('phcs').find(
      { is_active: true, name: { $in: PRIMARY_CARE_NAMES } },
      { projection: { id: 1, name: 1, facility_type: 1, _id: 0 } },
    )
      .toArray(),
  ]);
  const hospitalsByName = new Map(hospitals.map((hospital) => [hospital.name, hospital]));
  const phcsByName = new Map(phcs.map((phc) => [phc.name, phc]));
  const allowedHospitals = HOSPITAL_NAMES.flatMap((name) => {
    const hospital = hospitalsByName.get(name);
    return hospital ? [{ ...hospital, facility_type: 'hospital' }] : [];
  });
  const allowedPhcs = PRIMARY_CARE_NAMES.flatMap((name) => {
    const phc = phcsByName.get(name);
    return phc ? [{ ...phc, facility_type: name === CHC_NAME ? 'chc' : 'phc' }] : [];
  });
  const facilitiesByName = new Map(
    [...allowedHospitals, ...allowedPhcs].map((facility) => [facility.name, facility]),
  );
  const allowedFacilities = FACILITY_NAMES.flatMap((name) => {
    const facility = facilitiesByName.get(name);
    if (!facility) return [];
    return [{
      ...facility,
      facility_type: HOSPITAL_NAMES.includes(name)
        ? 'hospital'
        : name === CHC_NAME
          ? 'chc'
          : 'phc',
    }];
  });
  const facilitiesById = new Map(allowedFacilities.map((facility) => [facility.id, facility]));
  const hospitalIds = new Set(allowedHospitals.map(({ id }) => id));
  const phcIds = new Set(allowedPhcs.map(({ id }) => id));
  const activeDoctors = [];
  for (const doctor of doctors) {
    if (!hospitalIds.has(doctor.hospital_id) && !phcIds.has(doctor.phc_id)) continue;
    const user = await db.collection('users').findOne({ id: doctor.user_id, is_active: true });
    if (user) {
      const presence = await db.collection('user_presence').findOne({
        user_id: user.id,
        expires_at: { $gt: new Date() },
      });
      const facility = facilitiesById.get(doctor.hospital_id || doctor.phc_id);
      activeDoctors.push({
        id: doctor.id,
        specialty: doctor.specialty,
        qualification: doctor.qualification,
        availability: doctor.availability,
        is_demo: doctor.is_demo === true,
        hospital_id: doctor.hospital_id,
        phc_id: doctor.phc_id,
        facility_name: facility?.name || null,
        online_status: presence ? 'online' : 'offline',
        name: user.full_name,
      });
    }
  }
  activeDoctors.sort((left, right) => left.name.localeCompare(right.name));
  return {
    doctors: activeDoctors,
    facilities: allowedFacilities,
    hospitals: allowedHospitals,
    phcs: allowedPhcs,
  };
}

function dateBoundary(date) {
  return appointmentInstant(date, '00:00');
}

async function listAppointments(query, user) {
  const db = await getDb();
  if (query.directory === 'true') {
    return { directory: await directory(db), items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  }
  if (query.preferences === 'true') {
    const settings = await db.collection('user_settings').findOne({ user_id: user.sub, key: 'appointment_reminders' });
    return {
      preferences: settings?.value || { enabled: true, reminders_24h: true, reminders_2h: true },
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  }
  const paging = pageArgs(query);
  const requestedDate = query.appointment_date || query.date;
  const filter = { deleted_at: null };
  const scheduledRange = {};
  const addLowerBound = (date, operator = '$gte') => {
    const current = scheduledRange[operator];
    if (!current || date > current) scheduledRange[operator] = date;
  };
  const addUpperBound = (date) => {
    if (!scheduledRange.$lt || date < scheduledRange.$lt) scheduledRange.$lt = date;
  };
  if (query.status) filter.status = query.status;
  if (query.from) addLowerBound(dateBoundary(query.from));
  if (query.to) {
    const end = new Date(dateBoundary(query.to));
    end.setUTCDate(end.getUTCDate() + 1);
    addUpperBound(end);
  }
  if (query.doctor_id) filter.doctor_id = query.doctor_id;
  if (query.patient_id) filter.patient_id = query.patient_id;
  if (query.hospital_id) {
    filter.facility_type = 'hospital';
    filter.facility_id = query.hospital_id;
  }
  if (query.phc_id) {
    filter.facility_type = 'phc';
    filter.facility_id = query.phc_id;
  }
  if (requestedDate) {
    const start = dateBoundary(requestedDate);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    addLowerBound(start);
    addUpperBound(end);
  }
  if (query.upcoming === 'true') {
    addLowerBound(new Date(), '$gt');
    filter.status = { $in: query.status ? ACTIVE_STATUSES.filter((status) => status === query.status) : ACTIVE_STATUSES };
  } else if (query.upcoming === 'false') {
    const completedStatuses = ['completed', 'cancelled', 'no_show'];
    filter.status = { $in: query.status ? completedStatuses.filter((status) => status === query.status) : completedStatuses };
  }
  if (Object.keys(scheduledRange).length) filter.scheduled_at = scheduledRange;
  const sortDirection = query.upcoming === 'true' ? 1 : -1;
  const appointments = await db.collection('appointments').find(filter)
    .sort({ scheduled_at: sortDirection, id: 1 })
    .toArray();
  const items = [];
  for (const appointment of appointments) {
    const patient = await db.collection('patients').findOne({ id: appointment.patient_id });
    const doctor = await db.collection('doctors').findOne({ id: appointment.doctor_id });
    const doctorUser = doctor && await db.collection('users').findOne({ id: doctor.user_id });
    const patientUser = patient?.user_id && await db.collection('users').findOne({ id: patient.user_id });
    if (user.role === 'patient' && patient?.user_id !== user.sub) continue;
    if (user.role === 'doctor' && doctorUser?.id !== user.sub) continue;
    if (user.role === 'health_worker') {
      if (!patient) continue;
      const assignment = await db.collection('health_workers').findOne({
        user_id: user.sub,
        $or: [
          ...(patient.phc_id ? [{ phc_id: patient.phc_id }] : []),
          ...(patient.village_id ? [{ village_id: patient.village_id }] : []),
        ],
      });
      if (!assignment) continue;
    }
    const facility = await db.collection(appointment.facility_type === 'hospital' ? 'hospitals' : 'phcs')
      .findOne({ id: appointment.facility_id });
    items.push({
      id: appointment.id,
      patient_id: appointment.patient_id,
      doctor_id: appointment.doctor_id,
      facility_type: appointment.facility_type,
      facility_id: appointment.facility_id,
      scheduled_at: appointment.scheduled_at,
      status: appointment.status,
      reason: appointment.reason,
      mode: appointment.mode,
      time_slot: appointment.time_slot,
      deleted_at: appointment.deleted_at,
      patient_code: patient?.patient_code,
      patient_name: patient?.full_name,
      doctor_name: doctorUser?.full_name,
      specialty: doctor?.specialty,
      facility_name: facility?.name,
      patient_user_id: patientUser?.id,
    });
  }
  const total = items.length;
  const pagedItems = items.slice(paging.offset, paging.offset + paging.limit).map((item) => {
    const result = { ...item };
    delete result.patient_user_id;
    return result;
  });
  let availableSlots;
  if (query.doctor_id && requestedDate) {
    const facilityType = query.hospital_id ? 'hospital' : query.phc_id ? 'phc' : null;
    const facilityId = query.hospital_id || query.phc_id;
    if (facilityType && facilityId) {
      const collection = db.collection(facilityType === 'hospital' ? 'hospitals' : 'phcs');
      const facility = await collection.findOne({ id: facilityId, is_active: true });
      const allowedNames = facilityType === 'hospital' ? HOSPITAL_NAMES : PRIMARY_CARE_NAMES;
      if (!facility || !allowedNames.includes(facility.name)) {
        throw httpError(404, 'FACILITY_NOT_FOUND', 'The selected facility is not active or is not in the appointment directory');
      }
    }
    const doctor = facilityType
      ? await getDoctor(db, query.doctor_id, facilityType, facilityId)
      : await db.collection('doctors').findOne({ id: query.doctor_id });
    const start = dateBoundary(requestedDate);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const bookedRows = await db.collection('appointments').find({
      doctor_id: query.doctor_id,
      scheduled_at: { $gte: start, $lt: end },
      deleted_at: null,
      status: { $in: ACTIVE_STATUSES },
    }).toArray();
    const booked = new Set(bookedRows.map((row) => row.time_slot || new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(row.scheduled_at))));
    availableSlots = (doctor?.availability?.[availabilityDay(requestedDate)] || [])
      .filter((slot) => !booked.has(slot) && appointmentInstant(requestedDate, slot) > new Date());
  }
  return {
    items: pagedItems,
    available_slots: availableSlots,
    meta: { page: paging.page, limit: paging.limit, total, totalPages: Math.ceil(total / paging.limit) },
  };
}

async function getAppointment(db, id) {
  const appointment = await db.collection('appointments').findOne({ id });
  if (!appointment) throw httpError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
  const patient = await db.collection('patients').findOne({ id: appointment.patient_id });
  const doctor = appointment.doctor_id && await db.collection('doctors').findOne({ id: appointment.doctor_id });
  const doctorUser = doctor && await db.collection('users').findOne({ id: doctor.user_id });
  return { ...appointment, patient_user_id: patient?.user_id, doctor_user_id: doctorUser?.id };
}

async function canManage(db, appointment, user) {
  if (['admin', 'super_admin'].includes(user.role)) return;
  if (user.role === 'patient' && appointment.patient_user_id === user.sub) return;
  if (user.role === 'doctor' && appointment.doctor_user_id === user.sub) return;
  if (user.role === 'health_worker') {
    const patient = await db.collection('patients').findOne({ id: appointment.patient_id });
    if (patient) await patientAssignment(db, patient, user);
    else throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
    return;
  }
  throw httpError(403, 'FORBIDDEN', 'You are not allowed to manage this appointment');
}

async function updateAppointment(id, input, user, req) {
  const db = await getDb();
  const appointment = await getAppointment(db, id);
  if (input.action === 'reminder_preferences') {
    if (!['patient', 'doctor', 'health_worker', 'admin', 'super_admin'].includes(user.role)) {
      throw httpError(403, 'FORBIDDEN', 'You cannot update reminder preferences');
    }
    if (user.role === 'patient' && appointment.patient_user_id !== user.sub) {
      throw httpError(403, 'FORBIDDEN', 'You may only update your own preferences');
    }
    await canManage(db, appointment, user);
    if (!appointment.patient_user_id) {
      throw httpError(422, 'PATIENT_ACCOUNT_REQUIRED', 'Reminder preferences require a patient account');
    }
    const preferences = {
      ...input,
      enabled: input.enabled,
      reminders_24h: input.enabled && input.reminders_24h,
      reminders_2h: input.enabled && input.reminders_2h,
    };
    await setPreferences(db, appointment.patient_user_id, preferences);
    await audit(db, req, id, 'appointment.reminder_preferences_updated', preferences);
    return { preferences };
  }
  await canManage(db, appointment, user);
  if (input.action === 'confirm') {
    if (!['doctor', 'admin', 'super_admin'].includes(user.role)) {
      throw httpError(403, 'FORBIDDEN', 'Only facility staff or an administrator can confirm an appointment');
    }
    if (!['booked', 'rescheduled'].includes(appointment.status)) {
      throw httpError(409, 'APPOINTMENT_NOT_PENDING', 'Only a pending appointment request can be confirmed');
    }
  }
  if (input.action === 'complete' && user.role !== 'doctor') {
    throw httpError(403, 'FORBIDDEN', 'Only the assigned doctor can complete an appointment');
  }
  if (['cancel', 'reschedule'].includes(input.action) && !ACTIVE_STATUSES.includes(appointment.status)) {
    throw httpError(409, 'APPOINTMENT_NOT_ACTIVE', 'Only active appointments can be changed');
  }
  let update;
  if (input.action === 'confirm') {
    update = {
      $set: {
        status: 'confirmed',
        confirmed_at: new Date(),
        confirmed_by: user.sub,
        updated_at: new Date(),
      },
    };
  } else if (input.action === 'reschedule') {
    const scheduledAt = await validateSlot(
      db, appointment.doctor_id, appointment.facility_type, appointment.facility_id,
      input.appointment_date, input.time_slot, id,
    );
    update = {
      $set: {
        scheduled_at: scheduledAt,
        time_slot: input.time_slot,
        status: 'booked',
        reminder_24h_sent_at: null,
        reminder_2h_sent_at: null,
        updated_at: new Date(),
      },
      $unset: { confirmed_at: '', confirmed_by: '' },
    };
  } else {
    update = {
      $set: {
        status: input.action === 'cancel' ? 'cancelled' : input.action === 'complete' ? 'completed' : 'no_show',
        cancel_reason: input.action === 'cancel' ? input.reason : '',
        updated_at: new Date(),
      },
    };
  }
  const updated = await db.collection('appointments').findOneAndUpdate(
    { id, status: appointment.status },
    update,
    { returnDocument: 'after' },
  );
  if (!updated) throw httpError(409, 'APPOINTMENT_NOT_ACTIVE', 'Appointment was changed by another request');
  const notificationType = input.action === 'confirm'
    ? 'appointment_confirmed'
    : input.action === 'reschedule'
      ? 'appointment_rescheduled'
      : `appointment_${input.action}`;
  await notify(db, appointment.patient_user_id, notificationType, 'Appointment updated',
    `Your appointment status is now ${updated.status}.`, { appointment_id: id, status: updated.status });
  await notify(db, appointment.doctor_user_id, notificationType, 'Appointment updated',
    `An appointment status is now ${updated.status}.`, { appointment_id: id, status: updated.status });
  await audit(db, req, id, `appointment.${input.action}`, {
    status: updated.status,
    ...(input.action === 'reschedule' ? { scheduled_at: updated.scheduled_at } : {}),
    ...(input.action === 'cancel' ? { reason: input.reason } : {}),
  });
  return { appointment: updated };
}

async function deleteAppointment(id, user, req) {
  const db = await getDb();
  const appointment = await getAppointment(db, id);
  await canManage(db, appointment, user);
  if (appointment.status === 'completed') {
    throw httpError(409, 'APPOINTMENT_ALREADY_COMPLETED', 'Completed appointments cannot be deleted');
  }
  const updated = await db.collection('appointments').findOneAndUpdate(
    { id },
    {
      $set: {
        status: 'cancelled',
        deleted_at: new Date(),
        cancel_reason: 'Cancelled by owner or administrator',
        updated_at: new Date(),
      },
    },
    { returnDocument: 'after' },
  );
  await notify(db, appointment.patient_user_id, 'appointment_cancelled', 'Appointment cancelled',
    'Your appointment has been cancelled.', { appointment_id: id });
  await notify(db, appointment.doctor_user_id, 'appointment_cancelled', 'Appointment cancelled',
    'An appointment has been cancelled.', { appointment_id: id });
  await audit(db, req, id, 'appointment.deleted', { status: 'cancelled' });
  return updated;
}

async function dispatchAppointmentReminders() {
  const db = await getDb();
  const now = new Date();
  const appointments = await db.collection('appointments').find({
    deleted_at: null,
    status: { $in: ACTIVE_STATUSES },
    scheduled_at: { $gt: now, $lte: new Date(now.getTime() + 24 * 3600000) },
    $or: [
      { reminder_24h_sent_at: null },
      { reminder_2h_sent_at: null },
    ],
  }).sort({ scheduled_at: 1 }).limit(100).toArray();
  for (const appointment of appointments) {
    const patient = await db.collection('patients').findOne({ id: appointment.patient_id });
    const prefsDoc = patient?.user_id && await db.collection('user_settings')
      .findOne({ user_id: patient.user_id, key: 'appointment_reminders' });
    const prefs = prefsDoc?.value || {};
    const scheduledAt = new Date(appointment.scheduled_at);
    const due24 = !appointment.reminder_24h_sent_at && scheduledAt <= new Date(Date.now() + 24 * 3600000);
    const due2 = !appointment.reminder_2h_sent_at && scheduledAt <= new Date(Date.now() + 2 * 3600000);
    if (due24) {
      if (prefs.enabled !== false && prefs.reminders_24h !== false) {
        await notify(db, patient?.user_id, 'appointment_reminder', 'Appointment reminder',
          'Your appointment is within 24 hours.', { appointment_id: appointment.id, reminder: '24h' });
      }
      await db.collection('appointments').updateOne({ id: appointment.id }, { $set: { reminder_24h_sent_at: new Date() } });
    }
    if (due2) {
      if (prefs.enabled !== false && prefs.reminders_2h !== false) {
        await notify(db, patient?.user_id, 'appointment_reminder', 'Appointment reminder',
          'Your appointment is within 2 hours.', { appointment_id: appointment.id, reminder: '2h' });
      }
      await db.collection('appointments').updateOne({ id: appointment.id }, { $set: { reminder_2h_sent_at: new Date() } });
    }
  }
  return appointments.length;
}

module.exports = {
  createAppointment,
  listAppointments,
  updateAppointment,
  deleteAppointment,
  dispatchAppointmentReminders,
  appointmentInstant,
};
