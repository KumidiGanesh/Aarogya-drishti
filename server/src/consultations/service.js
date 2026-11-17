const { createHmac, randomUUID } = require('node:crypto');
const { getDb } = require('../db/mongo');
const video = require('../adapters/video');
const notifications = require('../services/notificationService');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function audit(db, req, action, entityId, metadata = {}) {
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: req.user.sub,
    action,
    entity: 'consultations',
    entity_id: entityId || null,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata,
    created_at: new Date(),
  });
}

function appointmentInWindow(scheduledAt) {
  const appointment = new Date(scheduledAt).getTime();
  const now = Date.now();
  return (
    Number.isFinite(appointment) &&
    now >= appointment - 30 * 60 * 1000 &&
    now <= appointment + 60 * 60 * 1000
  );
}

function configuredUrls(value, protocolPattern) {
  const urls = String(value || '').split(',').map((url) => url.trim()).filter(Boolean);
  if (
    urls.some((url) => {
      const separator = url.indexOf(':');
      return (
        !protocolPattern.test(url) ||
        separator < 0 ||
        !url.slice(separator + 1) ||
        /[\/\s@]/.test(url)
      );
    })
  ) {
    throw httpError(503, 'ICE_SERVERS_UNAVAILABLE', 'Secure call relay is not configured correctly');
  }
  return urls;
}

function validUrlList(value, protocolPattern) {
  const urls = String(value || '').split(',').map((url) => url.trim()).filter(Boolean);
  return urls.length > 0 && urls.every((url) => {
    const separator = url.indexOf(':');
    return (
      protocolPattern.test(url) &&
      separator >= 0 &&
      Boolean(url.slice(separator + 1)) &&
      !/[\/\s@]/.test(url)
    );
  });
}

function isCallSignalingConfigured() {
  return (
    validUrlList(process.env.STUN_URIS, /^stuns?:/i) &&
    validUrlList(process.env.TURN_URIS, /^turns?:/i) &&
    Buffer.byteLength(process.env.TURN_SHARED_SECRET || '') >= 32 &&
    Buffer.byteLength(process.env.CALL_TOKEN_SECRET || '') >= 32
  );
}

async function getIceServers(consultationId, user) {
  const db = await getDb();
  const context = await consultationContext(db, consultationId, user);
  const { appointment, consultation } = context;
  if (
    !appointment ||
    appointment.deleted_at ||
    !['booked', 'confirmed', 'rescheduled'].includes(appointment.status)
  ) {
    throw httpError(409, 'APPOINTMENT_NOT_ACTIVE', 'This appointment is no longer active');
  }
  if (!['audio', 'video'].includes(appointment.mode)) {
    throw httpError(422, 'CONSULTATION_MODE_REQUIRED', 'This appointment is not an audio or video visit');
  }
  if (!appointmentInWindow(appointment.scheduled_at)) {
    throw httpError(422, 'CONSULTATION_OUTSIDE_WINDOW', 'The call is not within the appointment time window');
  }
  if (!['scheduled', 'waiting', 'in_progress'].includes(consultation.status)) {
    throw httpError(409, 'CONSULTATION_NOT_AVAILABLE', 'This consultation is not available for a call');
  }
  const consent = await db.collection('patient_consents').findOne({
    patient_id: consultation.patient_id,
    consent_type: 'teleconsultation',
    granted: true,
  });
  if (!consent) {
    throw httpError(422, 'TELECONSULTATION_CONSENT_REQUIRED', 'Teleconsultation consent is required');
  }

  const stunUrls = configuredUrls(process.env.STUN_URIS, /^stuns?:/i);
  const turnUrls = configuredUrls(process.env.TURN_URIS, /^turns?:/i);
  const sharedSecret = process.env.TURN_SHARED_SECRET;
  if (
    !stunUrls.length ||
    !turnUrls.length ||
    !sharedSecret ||
    Buffer.byteLength(sharedSecret) < 32
  ) {
    throw httpError(503, 'ICE_SERVERS_UNAVAILABLE', 'Secure call relay is not configured');
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  const username = `${expiresAt}:${user.sub}`;
  const credential = createHmac('sha1', sharedSecret).update(username).digest('base64');
  return {
    ice_servers: [
      ...(stunUrls.length ? [{ urls: stunUrls }] : []),
      { urls: turnUrls, username, credential },
    ],
    expires_at: new Date(expiresAt * 1000),
  };
}

async function appointmentParticipants(db, appointment) {
  const patient = await db.collection('patients').findOne({ id: appointment.patient_id });
  const doctor =
    appointment.doctor_id &&
    (await db.collection('doctors').findOne({ id: appointment.doctor_id }));
  const doctorUser = doctor && (await db.collection('users').findOne({ id: doctor.user_id }));
  const patientUser =
    patient?.user_id && (await db.collection('users').findOne({ id: patient.user_id }));
  return {
    ...appointment,
    patient_user_id: patient?.user_id,
    patient_name: patient?.full_name,
    doctor_user_id: doctorUser?.id,
    doctor_name: doctorUser?.full_name,
    preferred_language: patientUser?.preferred_language,
  };
}

async function consultationContext(db, consultationId, user) {
  const consultation = await db.collection('consultations').findOne({ id: consultationId });
  if (!consultation) throw httpError(404, 'CONSULTATION_NOT_FOUND', 'Consultation not found');
  const [appointment, patient] = await Promise.all([
    consultation.appointment_id
      ? db.collection('appointments').findOne({ id: consultation.appointment_id })
      : null,
    db.collection('patients').findOne({ id: consultation.patient_id }),
  ]);
  const doctor = consultation.doctor_id
    ? await db.collection('doctors').findOne({ id: consultation.doctor_id })
    : null;
  const [doctorUser, patientUser] = await Promise.all([
    doctor ? db.collection('users').findOne({ id: doctor.user_id }) : null,
    patient?.user_id ? db.collection('users').findOne({ id: patient.user_id }) : null,
  ]);
  const context = {
    consultation,
    appointment,
    patient,
    doctor,
    doctorUser,
    patientUser,
    patient_user_id: patientUser?.id,
    doctor_user_id: doctorUser?.id,
  };
  if (
    (user.role === 'patient' && context.patient_user_id !== user.sub) ||
    (user.role === 'doctor' && context.doctor_user_id !== user.sub) ||
    !['patient', 'doctor', 'admin', 'super_admin'].includes(user.role)
  ) {
    throw httpError(403, 'FORBIDDEN', 'You are not allowed to view this consultation');
  }
  return context;
}

async function getById(consultationId, user) {
  const db = await getDb();
  const context = await consultationContext(db, consultationId, user);
  const notes = await db
    .collection('consultation_notes')
    .find({ consultation_id: consultationId })
    .sort({ created_at: 1 })
    .toArray();
  const result = {
    id: context.consultation.id,
    appointment_id: context.consultation.appointment_id,
    patient_id: context.consultation.patient_id,
    doctor_id: context.consultation.doctor_id,
    patient_name: context.patient?.full_name,
    doctor_name: context.doctorUser?.full_name,
    scheduled_at: context.appointment?.scheduled_at,
    mode: context.appointment?.mode,
    appointment_status: context.appointment?.status,
    status: context.consultation.status,
    provider: context.consultation.provider,
    started_at: context.consultation.started_at,
    ended_at: context.consultation.ended_at,
    duration_seconds: context.consultation.duration_seconds ?? null,
    follow_up_recommendation: context.consultation.follow_up_recommendation,
    follow_up_at: context.consultation.follow_up_at,
    prescription_id: context.consultation.prescription_id ?? null,
    notes: notes.map(({ note, created_at }) => ({ note, created_at })),
    created_at: context.consultation.created_at,
    updated_at: context.consultation.updated_at,
  };
  return result;
}

async function getCallHistory(consultationId, user) {
  const db = await getDb();
  await consultationContext(db, consultationId, user);
  const calls = await db
    .collection('consultation_calls')
    .find({ consultation_id: consultationId })
    .sort({ created_at: -1 })
    .limit(100)
    .toArray();
  const history = [];
  for (const call of calls) {
    const participants = [];
    for (const participant of call.participants || []) {
      const participantUser = await db.collection('users').findOne({ id: participant.user_id });
      participants.push({
        role: participant.role,
        name: participantUser?.full_name || '',
        joined_at: call[`${participant.role}_joined_at`] || participant.joined_at || null,
        left_at: call[`${participant.role}_left_at`] || participant.left_at || null,
      });
    }
    history.push({
      id: call.id,
      type: call.type,
      status: call.status,
      initiated_at: call.initiated_at,
      accepted_at: call.accepted_at || null,
      rejected_at: call.rejected_at || null,
      ended_at: call.ended_at || null,
      duration_seconds: call.duration_seconds ?? null,
      participants,
    });
  }
  return history;
}

async function create(input, user, req) {
  const db = await getDb();
  if (input.action === 'schedule') {
    const rawAppointment = await db.collection('appointments').findOne({
      id: input.appointment_id,
      deleted_at: null,
      status: { $in: ['booked', 'confirmed', 'rescheduled'] },
    });
    if (!rawAppointment) throw httpError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
    const appointment = await appointmentParticipants(db, rawAppointment);
    if (!['audio', 'video'].includes(appointment.mode)) {
      throw httpError(
        422,
        'CONSULTATION_MODE_REQUIRED',
        'Only audio or video appointments can be scheduled as consultations',
      );
    }
    if (
      (user.role === 'patient' && appointment.patient_user_id !== user.sub) ||
      (user.role === 'doctor' && appointment.doctor_user_id !== user.sub)
    )
      throw httpError(403, 'FORBIDDEN', 'You are not a participant in this appointment');
    if (user.role === 'patient' && appointment.patient_user_id !== user.sub) {
      throw httpError(
        403,
        'FORBIDDEN',
        'You may only schedule a consultation for your own appointment',
      );
    }
    const consent = await db.collection('patient_consents').findOne({
      patient_id: appointment.patient_id,
      consent_type: 'teleconsultation',
      granted: true,
    });
    if (!consent)
      throw httpError(
        422,
        'TELECONSULTATION_CONSENT_REQUIRED',
        'Teleconsultation consent is required',
      );
    if (!video.isConfigured()) {
      throw httpError(
        503,
        'VIDEO_PROVIDER_UNAVAILABLE',
        'A secure video provider is not configured',
      );
    }
    let consultation = await db
      .collection('consultations')
      .findOne({ appointment_id: appointment.id });
    let created = false;
    if (!consultation) {
      consultation = {
        id: randomUUID(),
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        doctor_id: appointment.doctor_id,
        status: 'scheduled',
        provider: 'jitsi',
        provider_room_id: video.createRoom(),
        duration_seconds: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      try {
        await db.collection('consultations').insertOne(consultation);
        created = true;
      } catch (error) {
        if (error.code !== 11000) throw error;
        consultation = await db
          .collection('consultations')
          .findOne({ appointment_id: appointment.id });
      }
    }
    await audit(db, req, 'consultation.schedule', consultation.id, {
      appointment_id: appointment.id,
      already_scheduled: !created,
    });
    if (created) {
      const data = { consultation_id: consultation.id, appointment_id: appointment.id };
      await notifications.create(db, appointment.patient_user_id, 'consultation', data, {
        type: 'consultation',
      });
      await notifications.create(db, appointment.doctor_user_id, 'consultation', data, {
        type: 'consultation',
      });
    }
    return { consultation_id: consultation.id, status: consultation.status };
  }

  const consultation = await db.collection('consultations').findOne({ id: input.consultation_id });
  if (!consultation) throw httpError(404, 'CONSULTATION_NOT_FOUND', 'Consultation not found');
  const [appointment, participants] = await Promise.all([
    consultation.appointment_id
      ? db.collection('appointments').findOne({ id: consultation.appointment_id })
      : null,
    (async () => {
      const patient = await db.collection('patients').findOne({ id: consultation.patient_id });
      const doctor =
        consultation.doctor_id &&
        (await db.collection('doctors').findOne({ id: consultation.doctor_id }));
      const doctorUser = doctor && (await db.collection('users').findOne({ id: doctor.user_id }));
      return {
        patient_user_id: patient?.user_id,
        patient_name: patient?.full_name,
        doctor_user_id: doctorUser?.id,
      };
    })(),
  ]);
  const hydrated = {
    ...consultation,
    scheduled_at: appointment?.scheduled_at,
    mode: appointment?.mode,
    ...participants,
  };
  if (
    (user.role === 'patient' && hydrated.patient_user_id !== user.sub) ||
    (user.role === 'doctor' && hydrated.doctor_user_id !== user.sub)
  )
    throw httpError(403, 'FORBIDDEN', 'You are not a participant in this consultation');
  if (input.action === 'join') {
    if (
      !appointment ||
      appointment.deleted_at ||
      !['booked', 'confirmed', 'rescheduled'].includes(appointment.status)
    ) {
      throw httpError(409, 'APPOINTMENT_NOT_ACTIVE', 'This appointment is no longer active');
    }
    if (!appointmentInWindow(appointment.scheduled_at)) {
      throw httpError(
        422,
        'CONSULTATION_OUTSIDE_WINDOW',
        'The call opens 30 minutes before the appointment and closes 60 minutes after it',
      );
    }
    if (!video.isConfigured()) {
      throw httpError(
        503,
        'VIDEO_PROVIDER_UNAVAILABLE',
        'A secure video provider is not configured',
      );
    }
    if (!['scheduled', 'in_progress'].includes(consultation.status)) {
      throw httpError(
        409,
        'CONSULTATION_NOT_AVAILABLE',
        'This consultation is not available to join',
      );
    }
    const join = await createJoin(consultation, user, {
      ...hydrated,
      status: appointment.status,
    });
    if (!join) {
      throw httpError(
        422,
        'TELECONSULTATION_CONSENT_REQUIRED',
        'Active teleconsultation consent is required to join',
      );
    }
    await audit(db, req, 'consultation.join', consultation.id, { provider: join.provider });
    return { consultation_id: consultation.id, status: consultation.status, join };
  }
  if (input.action === 'add_note') {
    if (user.role !== 'doctor')
      throw httpError(403, 'FORBIDDEN', 'Only the doctor can add consultation notes');
    const note = input.follow_up_recommendation
      ? `${input.note}\n\nFollow-up recommendation: ${input.follow_up_recommendation}`
      : input.note;
    await db.collection('consultation_notes').insertOne({
      id: randomUUID(),
      consultation_id: consultation.id,
      author_id: user.sub,
      note,
      created_at: new Date(),
    });
    if (input.follow_up_recommendation) {
      await db.collection('consultations').updateOne(
        { id: consultation.id },
        {
          $set: {
            follow_up_recommendation: input.follow_up_recommendation,
            follow_up_at: input.follow_up_date
              ? new Date(`${input.follow_up_date}T09:00:00+05:30`)
              : null,
            updated_at: new Date(),
          },
        },
      );
      if (hydrated.patient_user_id)
        await notifications.create(
          db,
          hydrated.patient_user_id,
          'followup',
          {
            consultation_id: consultation.id,
            recommendation: input.follow_up_recommendation,
          },
          { type: 'followup' },
        );
    }
    await audit(db, req, 'consultation.note.add', consultation.id);
    return {
      consultation_id: consultation.id,
      note: input.note,
      follow_up_recommendation: input.follow_up_recommendation || null,
    };
  }
  if (!['doctor', 'admin'].includes(user.role)) {
    throw httpError(403, 'FORBIDDEN', 'Only the doctor can change consultation status');
  }
  if (
    input.action === 'start' &&
    (!appointment ||
      appointment.deleted_at ||
      !['booked', 'confirmed', 'rescheduled'].includes(appointment.status))
  ) {
    throw httpError(409, 'APPOINTMENT_NOT_ACTIVE', 'This appointment is no longer active');
  }
  if (input.action === 'start') {
    const activeConsent = await db.collection('patient_consents').findOne({
      patient_id: consultation.patient_id,
      consent_type: 'teleconsultation',
      granted: true,
    });
    if (!activeConsent) {
      throw httpError(
        422,
        'TELECONSULTATION_CONSENT_REQUIRED',
        'Active teleconsultation consent is required to start',
      );
    }
  }
  if (!appointmentInWindow(hydrated.scheduled_at)) {
    throw httpError(
      422,
      'CONSULTATION_OUTSIDE_WINDOW',
      'Consultation can only be started or ended near the appointment time',
    );
  }
  const nextStatus = input.action === 'start' ? 'in_progress' : 'completed';
  if (input.action === 'start' && consultation.status !== 'scheduled') {
    throw httpError(409, 'CONSULTATION_NOT_SCHEDULED', 'Consultation is not scheduled');
  }
  if (input.action !== 'start' && consultation.status !== 'in_progress') {
    throw httpError(409, 'CONSULTATION_NOT_IN_PROGRESS', 'Consultation is not in progress');
  }
  const now = new Date();
  const startedAt = consultation.started_at ? new Date(consultation.started_at).getTime() : NaN;
  const durationSeconds = Number.isFinite(startedAt)
    ? Math.max(0, Math.floor((now.getTime() - startedAt) / 1000))
    : null;
  const update = {
    status: nextStatus,
    updated_at: now,
    ...(input.action === 'start'
      ? { started_at: now }
      : { ended_at: now, duration_seconds: durationSeconds }),
  };
  const changed = await db
    .collection('consultations')
    .updateOne({ id: consultation.id, status: consultation.status }, { $set: update });
  if (!changed.modifiedCount)
    throw httpError(
      409,
      'CONSULTATION_STATUS_CHANGED',
      'Consultation status was changed by another request',
    );
  await audit(db, req, `consultation.${input.action}`, consultation.id);
  return { consultation_id: consultation.id, status: nextStatus };
}

async function callAction(consultationId, input, user, req) {
  const db = await getDb();
  const context = await consultationContext(db, consultationId, user);
  if (!['doctor', 'patient'].includes(user.role)) {
    throw httpError(403, 'FORBIDDEN', 'Only the appointment participants can manage a call');
  }
  const { consultation, appointment, doctorUser, patientUser } = context;
  const calls = db.collection('consultation_calls');

  if (input.action === 'initiate') {
    if (
      !appointment ||
      appointment.deleted_at ||
      !['booked', 'confirmed', 'rescheduled'].includes(appointment.status)
    ) {
      throw httpError(409, 'APPOINTMENT_NOT_ACTIVE', 'This appointment is no longer active');
    }
    if (!appointmentInWindow(appointment.scheduled_at)) {
      throw httpError(
        422,
        'CONSULTATION_OUTSIDE_WINDOW',
        'The call opens 30 minutes before the appointment and closes 60 minutes after it',
      );
    }
    if (!['audio', 'video'].includes(appointment.mode)) {
      throw httpError(422, 'CONSULTATION_MODE_REQUIRED', 'This appointment is not an audio or video visit');
    }
    if (!['scheduled', 'waiting', 'in_progress'].includes(consultation.status)) {
      throw httpError(409, 'CONSULTATION_NOT_AVAILABLE', 'This consultation is not available for a call');
    }
    const consent = await db.collection('patient_consents').findOne({
      patient_id: consultation.patient_id,
      consent_type: 'teleconsultation',
      granted: true,
    });
    if (!consent) {
      throw httpError(
        422,
        'TELECONSULTATION_CONSENT_REQUIRED',
        'Teleconsultation consent is required',
      );
    }
    const participants = [
      { user_id: patientUser?.id, role: 'patient', joined_at: null, left_at: null },
      { user_id: doctorUser?.id, role: 'doctor', joined_at: null, left_at: null },
    ];
    const recipient = user.role === 'patient' ? doctorUser : patientUser;
    if (
      !recipient?.is_active ||
      recipient.deleted_at ||
      recipient.id === user.sub
    ) {
      throw httpError(409, 'PARTICIPANT_UNAVAILABLE', 'The other appointment participant is unavailable');
    }
    const activeCallFilter = {
      status: { $in: ['ringing', 'accepted'] },
      $or: [{ caller_user_id: user.sub }, { recipient_user_id: user.sub }],
    };
    const busyCall = await calls.findOne(activeCallFilter);
    if (busyCall) {
      throw httpError(409, 'CALL_BUSY', 'You are already participating in another active call');
    }
    const targetBusyCall = await calls.findOne({
      status: { $in: ['ringing', 'accepted'] },
      $or: [
        { caller_user_id: recipient.id },
        { recipient_user_id: recipient.id },
      ],
    });
    if (targetBusyCall) {
      throw httpError(409, 'CALL_BUSY', 'The other appointment participant is already in a call');
    }
    const now = new Date();
    const call = {
      id: randomUUID(),
      consultation_id: consultation.id,
      appointment_id: appointment.id,
      type: appointment.mode,
      status: 'ringing',
      caller_user_id: user.sub,
      caller_role: user.role,
      recipient_user_id: recipient.id,
      recipient_role: user.role === 'patient' ? 'doctor' : 'patient',
      participants,
      participants_user_ids: participants.map(({ user_id }) => user_id).filter(Boolean),
      initiated_at: now,
      accepted_at: null,
      rejected_at: null,
      connected_at: null,
      patient_joined_at: null,
      patient_left_at: null,
      doctor_joined_at: null,
      doctor_left_at: null,
      ended_at: null,
      duration_seconds: null,
      created_at: now,
      updated_at: now,
    };
    try {
      await calls.insertOne(call);
    } catch (error) {
      if (error.code === 11000) {
        throw httpError(409, 'CALL_BUSY', 'An appointment participant is already in a call');
      }
      throw error;
    }
    if (consultation.status === 'scheduled') {
      await db.collection('consultations').updateOne(
        { id: consultation.id, status: 'scheduled' },
        { $set: { status: 'waiting', waiting_since: now, updated_at: now } },
      );
    }
    await notifications.create(
      db,
      recipient.id,
      'consultation',
      { consultation_id: consultation.id, appointment_id: appointment.id, call_id: call.id },
      { type: 'consultation' },
    );
    await audit(db, req, 'consultation.call.initiated', call.id, {
      consultation_id: consultation.id,
      type: call.type,
    });
    const presence = await db.collection('user_presence').findOne({
      user_id: recipient.id,
      expires_at: { $gt: new Date() },
    });
    return {
      id: call.id,
      consultation_id: call.consultation_id,
      type: call.type,
      status: call.status,
      initiated_at: call.initiated_at,
      recipient_online: Boolean(presence),
    };
  }

  const call = await calls.findOne({ id: input.call_id, consultation_id: consultation.id });
  if (!call) throw httpError(404, 'CALL_NOT_FOUND', 'Call record not found');
  if (![call.caller_user_id, call.recipient_user_id].includes(user.sub)) {
    throw httpError(403, 'FORBIDDEN', 'You are not a participant in this call');
  }
  const now = new Date();
  const update = { updated_at: now };
  if (input.action === 'accept' || input.action === 'reject') {
    if (call.recipient_user_id !== user.sub) {
      throw httpError(403, 'FORBIDDEN', 'Only the invited participant can accept or reject this call');
    }
    if (call.status !== 'ringing') {
      throw httpError(409, 'CALL_NOT_RINGING', 'This call is no longer waiting for an answer');
    }
    if (input.action === 'accept') {
      update.status = 'accepted';
      update.accepted_at = now;
    } else {
      update.status = 'rejected';
      update.rejected_at = now;
      update.ended_at = now;
    }
  } else if (input.action === 'missed') {
    if (call.status !== 'ringing') {
      throw httpError(409, 'CALL_NOT_RINGING', 'This call is no longer ringing');
    }
    if (now.getTime() < new Date(call.initiated_at).getTime() + 45_000) {
      throw httpError(409, 'CALL_TIMEOUT_PENDING', 'The call has not rung long enough to mark it missed');
    }
    update.status = 'missed';
    update.ended_at = now;
  } else if (input.action === 'end') {
    if (!['ringing', 'accepted'].includes(call.status)) {
      throw httpError(409, 'CALL_NOT_ACTIVE', 'This call is no longer active');
    }
    update.status = 'ended';
    update.ended_at = now;
    update.duration_seconds = call.connected_at
      ? Math.max(0, Math.floor((now.getTime() - new Date(call.connected_at).getTime()) / 1000))
      : null;
  }
  const changed = await calls.updateOne(
    { id: call.id, consultation_id: consultation.id, status: call.status },
    { $set: update },
  );
  if (!changed.modifiedCount) {
    throw httpError(409, 'CALL_STATUS_CHANGED', 'The call changed before this action completed');
  }
  if (
    input.action === 'end' &&
    input.reason === 'connection_timeout' &&
    ['waiting', 'in_progress'].includes(consultation.status)
  ) {
    await db.collection('consultations').updateOne(
      { id: consultation.id, status: consultation.status },
      {
        $set: { status: 'scheduled', updated_at: now },
        $unset: { started_at: '', ended_at: '', duration_seconds: '' },
      },
    );
  } else if (input.action === 'reject' && consultation.status === 'waiting') {
    await db.collection('consultations').updateOne(
      { id: consultation.id, status: 'waiting' },
      { $set: { status: 'scheduled', updated_at: now } },
    );
  } else if (
    input.action === 'end' &&
    call.status === 'ringing' &&
    consultation.status === 'waiting'
  ) {
    await db.collection('consultations').updateOne(
      { id: consultation.id, status: 'waiting' },
      { $set: { status: 'scheduled', updated_at: now } },
    );
  } else if (
    input.action === 'end' &&
    call.status === 'accepted' &&
    !call.connected_at &&
    consultation.status === 'waiting'
  ) {
    await db.collection('consultations').updateOne(
      { id: consultation.id, status: 'waiting' },
      { $set: { status: 'scheduled', updated_at: now } },
    );
  } else if (input.action === 'missed' && consultation.status === 'waiting') {
    await db.collection('consultations').updateOne(
      { id: consultation.id, status: 'waiting' },
      { $set: { status: 'missed', ended_at: now, updated_at: now } },
    );
  } else if (
    input.action === 'end' &&
    user.role === 'doctor' &&
    consultation.status === 'in_progress'
  ) {
    await db.collection('consultations').updateOne(
      { id: consultation.id, status: 'in_progress' },
      {
        $set: {
          status: 'completed',
          ended_at: now,
          duration_seconds: update.duration_seconds,
          updated_at: now,
        },
      },
    );
  }
  await audit(db, req, `consultation.call.${input.action}`, call.id, {
    consultation_id: consultation.id,
    status: update.status,
  });
  return {
    id: call.id,
    consultation_id: call.consultation_id,
    type: call.type,
    status: update.status,
    ended_at: update.ended_at || null,
    duration_seconds: update.duration_seconds ?? null,
  };
}

async function createJoin(consultation, user, appointment) {
  if (
    !['doctor', 'patient'].includes(user.role) ||
    (user.role === 'patient' && appointment.patient_user_id !== user.sub) ||
    (user.role === 'doctor' && appointment.doctor_user_id !== user.sub)
  )
    return null;
  if (
    !appointmentInWindow(appointment.scheduled_at) ||
    !['booked', 'confirmed', 'rescheduled'].includes(appointment.status) ||
    !['scheduled', 'in_progress'].includes(consultation.status)
  )
    return null;
  const db = await getDb();
  const consent = await db.collection('patient_consents').findOne({
    patient_id: consultation.patient_id,
    consent_type: 'teleconsultation',
    granted: true,
  });
  if (!consent) return null;
  const tokenExpiresAt = new Date(appointment.scheduled_at).getTime() + 60 * 60 * 1000 + 30 * 1000;
  const expiresInSeconds = Math.ceil((tokenExpiresAt - Date.now()) / 1000);
  if (expiresInSeconds <= 0) return null;
  const participantName = user.role === 'doctor' ? 'Doctor' : 'Patient';
  return {
    provider: 'jitsi',
    domain: video.getDomain(),
    room: consultation.provider_room_id,
    token: video.createParticipantToken(
      consultation.provider_room_id,
      `${user.role}-${randomUUID()}`,
      participantName,
      user.role === 'doctor',
      expiresInSeconds,
    ),
    display_name: participantName,
    expires_in_seconds: expiresInSeconds,
    audio_only: appointment.mode === 'audio',
  };
}

function dateBoundary(date) {
  return new Date(`${date}T00:00:00+05:30`);
}

async function list(query, user) {
  const db = await getDb();
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit > 100) {
    throw httpError(
      400,
      'INVALID_PAGINATION',
      'page must be positive and limit must be between 1 and 100',
    );
  }
  if (query.availability === 'true') {
    const filter = {};
    if (query.doctor_id) filter.id = query.doctor_id;
    if (user.role === 'doctor') filter.user_id = user.sub;
    const doctors = await db.collection('doctors').find(filter).limit(100).toArray();
    const availability = [];
    for (const doctor of doctors) {
      if (doctor.is_demo === true) continue;
      const doctorUser = await db
        .collection('users')
        .findOne({ id: doctor.user_id, is_active: true });
      if (doctorUser) {
        const [presence, facility] = await Promise.all([
          db.collection('user_presence').findOne({
            user_id: doctor.user_id,
            expires_at: { $gt: new Date() },
          }),
          doctor.hospital_id || doctor.phc_id
            ? db.collection(doctor.hospital_id ? 'hospitals' : 'phcs').findOne({
                id: doctor.hospital_id || doctor.phc_id,
                is_active: true,
              })
            : null,
        ]);
        availability.push({
          id: doctor.id,
          specialty: doctor.specialty,
          qualification: doctor.qualification,
          availability: doctor.availability,
          full_name: doctorUser.full_name,
          hospital_id: doctor.hospital_id,
          phc_id: doctor.phc_id,
          facility_name: facility?.name || null,
          online_status: presence ? 'online' : 'offline',
        });
      }
    }
    availability.sort((left, right) => left.full_name.localeCompare(right.full_name));
    return {
      items: [],
      availability,
      provider_configured: video.isConfigured(),
      call_signaling_configured: isCallSignalingConfigured(),
      meta: { page: 1, limit: 100, total: availability.length, totalPages: 1 },
    };
  }
  const consultations = await db.collection('consultations').find({}).toArray();
  const items = [];
  for (const consultation of consultations) {
    const appointment = consultation.appointment_id
      ? await db.collection('appointments').findOne({ id: consultation.appointment_id })
      : null;
    const patient = await db.collection('patients').findOne({ id: consultation.patient_id });
    const doctor =
      consultation.doctor_id &&
      (await db.collection('doctors').findOne({ id: consultation.doctor_id }));
    const doctorUser = doctor && (await db.collection('users').findOne({ id: doctor.user_id }));
    if (user.role === 'patient' && patient?.user_id !== user.sub) continue;
    if (user.role === 'doctor' && doctorUser?.id !== user.sub) continue;
    if (query.patient_id && consultation.patient_id !== query.patient_id) continue;
    if (query.doctor_id && consultation.doctor_id !== query.doctor_id) continue;
    if (query.status && consultation.status !== query.status) continue;
    const scheduledAt = appointment?.scheduled_at ? new Date(appointment.scheduled_at) : null;
    if (query.from && (!scheduledAt || scheduledAt < dateBoundary(query.from))) continue;
    if (query.to) {
      const end = dateBoundary(query.to);
      end.setDate(end.getDate() + 1);
      if (!scheduledAt || scheduledAt >= end) continue;
    }
    const notes = await db
      .collection('consultation_notes')
      .find({ consultation_id: consultation.id })
      .sort({ created_at: 1 })
      .toArray();
    const row = {
      id: consultation.id,
      appointment_id: consultation.appointment_id,
      patient_id: consultation.patient_id,
      patient_code: patient?.patient_code,
      doctor_id: consultation.doctor_id,
      status: consultation.status,
      provider: consultation.provider,
      provider_room_id: consultation.provider_room_id,
      started_at: consultation.started_at,
      ended_at: consultation.ended_at,
      duration_seconds: consultation.duration_seconds ?? null,
      prescription_id: consultation.prescription_id ?? null,
      follow_up_recommendation: consultation.follow_up_recommendation,
      follow_up_at: consultation.follow_up_at,
      reminder_30m_sent_at: consultation.reminder_30m_sent_at,
      reminder_10m_sent_at: consultation.reminder_10m_sent_at,
      follow_up_reminder_sent_at: consultation.follow_up_reminder_sent_at,
      scheduled_at: appointment?.scheduled_at,
      mode: appointment?.mode,
      patient_name: patient?.full_name,
      doctor_name: doctorUser?.full_name,
      appointment_status: appointment?.status,
      appointment_deleted_at: appointment?.deleted_at,
      notes: notes.map(({ note, created_at }) => ({ note, created_at })),
    };
    items.push(row);
  }
  items.sort((left, right) => new Date(right.scheduled_at || 0) - new Date(left.scheduled_at || 0));
  const total = items.length;
  const selected = items.slice((page - 1) * limit, page * limit);
  const result = [];
  for (const row of selected) {
    let consentGranted = false;
    const appointmentInWindowNow = appointmentInWindow(row.scheduled_at);
    const appointmentActive =
      !row.appointment_deleted_at &&
      ['booked', 'confirmed', 'rescheduled'].includes(row.appointment_status);
    if (
      appointmentActive &&
      ['audio', 'video'].includes(row.mode) &&
      ['scheduled', 'waiting', 'in_progress'].includes(row.status)
    ) {
      consentGranted = Boolean(
        await db.collection('patient_consents').findOne({
          patient_id: row.patient_id,
          consent_type: 'teleconsultation',
          granted: true,
        }),
      );
    }
      const callWindowOpen = appointmentActive && appointmentInWindowNow;
    const safeRow = {
      ...row,
        join_available: callWindowOpen && consentGranted,
      teleconsultation_consent_granted: consentGranted,
      call_window_open: callWindowOpen,
    };
    delete safeRow.provider_room_id;
    delete safeRow.appointment_status;
    delete safeRow.appointment_deleted_at;
    result.push(safeRow);
  }
  return {
    items: result,
    provider_configured: video.isConfigured(),
    call_signaling_configured: isCallSignalingConfigured(),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

module.exports = {
  create,
  list,
  getById,
  getCallHistory,
  getIceServers,
  callAction,
  isCallSignalingConfigured,
};
