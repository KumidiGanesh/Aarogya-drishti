const { randomUUID } = require('node:crypto');
const { getDb } = require('../db/mongo');
const storage = require('../adapters/privateImageStorage');
const getNotificationCopy = require('../notifications/phase8Copy');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function pagination(query) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw httpError(400, 'INVALID_PAGINATION', 'page must be positive and limit must be between 1 and 100');
  }
  return { page, limit, offset: (page - 1) * limit };
}

function dateStart(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateAfter(value) {
  const date = dateStart(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

async function audit(db, req, referralId, action, metadata = {}) {
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: req.user.sub,
    action,
    entity: 'referral',
    entity_id: referralId,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata,
    created_at: new Date(),
  });
}

async function notification(db, userId, type, _title, _body, data) {
  if (!userId) return;
  const user = await db.collection('users').findOne({ id: userId });
  if (!user) return;
  const [title, body] = getNotificationCopy(user.preferred_language || 'en', type);
  const now = new Date();
  await db.collection('notifications').insertOne({
    id: randomUUID(),
    user_id: userId,
    notification_type: 'referral',
    title,
    body,
    data,
    read_at: null,
    created_at: now,
    updated_at: now,
  });
}

async function getReferral(db, id) {
  const referral = await db.collection('referrals').findOne({ id });
  if (!referral) throw httpError(404, 'REFERRAL_NOT_FOUND', 'Referral not found');
  const patient = await db.collection('patients').findOne({ id: referral.patient_id });
  if (!patient) throw httpError(404, 'REFERRAL_NOT_FOUND', 'Referral not found');
  const specialist = referral.referred_to_specialist_id
    ? await db.collection('specialists').findOne({ id: referral.referred_to_specialist_id })
    : null;
  return {
    ...referral,
    patient_user_id: patient.user_id,
    specialist_user_id: specialist?.user_id || null,
  };
}

async function assignedPatient(db, patientId, user) {
  if (user.role !== 'health_worker') return;
  const [patient, worker] = await Promise.all([
    db.collection('patients').findOne({ id: patientId }),
    db.collection('health_workers').findOne({ user_id: user.sub }),
  ]);
  if (!patient || !worker || !(
    (worker.phc_id && worker.phc_id === patient.phc_id)
    || (worker.village_id && worker.village_id === patient.village_id)
  )) {
    throw httpError(403, 'OUTSIDE_ASSIGNED_AREA', 'Patient is outside your assigned area');
  }
}

function canAccess(referral, user) {
  if (['admin', 'super_admin'].includes(user.role)) return true;
  if (user.role === 'patient') return referral.patient_user_id === user.sub;
  if (user.role === 'specialist') return referral.specialist_user_id === user.sub;
  if (user.role === 'health_worker') return true;
  if (user.role === 'doctor') return referral.referred_by === user.sub;
  return false;
}

function fileType(buffer, declared) {
  const pdf = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const detected = pdf ? 'application/pdf' : jpeg ? 'image/jpeg' : png ? 'image/png' : null;
  if (!detected || detected !== declared) {
    throw httpError(422, 'DOCUMENT_TYPE_MISMATCH', 'Document content must match its PDF, JPEG, or PNG file type');
  }
  return detected;
}

async function createReferral(input, files, user, req) {
  if (user.role !== 'doctor' && user.role !== 'admin' && user.role !== 'super_admin') {
    throw httpError(403, 'FORBIDDEN', 'Only a doctor or administrator can create a referral');
  }
  if (user.role !== 'doctor') {
    throw httpError(403, 'FORBIDDEN', 'Administrators may manage referrals but cannot originate clinical referrals');
  }
  const storedKeys = [];
  let db;
  try {
    db = await getDb();
    const patient = await db.collection('patients').findOne({
      id: input.patient_id,
      is_active: true,
      deleted_at: null,
    });
    if (!patient) throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
    const specialist = await db.collection('specialists').findOne({ id: input.specialist_id });
    const specialistUser = specialist && await db.collection('users').findOne({
      id: specialist.user_id,
      is_active: true,
    });
    if (!specialist || !specialistUser) throw httpError(404, 'SPECIALIST_NOT_FOUND', 'Specialist not found');
    const hospital = await db.collection('hospitals').findOne({
      id: input.referral_hospital_id,
      is_active: true,
    });
    if (!hospital) throw httpError(404, 'HOSPITAL_NOT_FOUND', 'Hospital not found');
    if (input.screening_id) {
      const screening = await db.collection('oral_screenings').findOne({
        id: input.screening_id,
        patient_id: patient.id,
      });
      if (!screening) {
        throw httpError(422, 'SCREENING_PATIENT_MISMATCH', 'The screening must belong to this patient');
      }
    }

    const now = new Date();
    const referral = {
      id: randomUUID(),
      patient_id: patient.id,
      screening_id: input.screening_id || null,
      referred_by: user.sub,
      referred_to_specialist_id: specialist.id,
      hospital_id: input.referral_hospital_id,
      status: 'pending',
      reason: input.reason,
      urgency: input.urgency,
      feedback: '',
      created_at: now,
      updated_at: now,
    };
    await db.collection('referrals').insertOne(referral);
    await db.collection('referral_events').insertOne({
      id: randomUUID(),
      referral_id: referral.id,
      actor_id: user.sub,
      event_type: 'created',
      details: { status: 'pending', reason: input.reason },
      created_at: now,
      updated_at: now,
    });

    const documents = [];
    for (const file of files) {
      const mimeType = fileType(file.buffer, file.mimetype);
      const encrypted = await storage.encryptAndStore(file.buffer);
      storedKeys.push(encrypted.storage_key);
      const document = {
        id: randomUUID(),
        referral_id: referral.id,
        storage_key: encrypted.storage_key,
        content_hash: encrypted.content_hash,
        encryption_algorithm: encrypted.encryption_algorithm,
        encryption_key_id: encrypted.encryption_key_id,
        encryption_iv: encrypted.encryption_iv,
        encryption_auth_tag: encrypted.encryption_auth_tag,
        mime_type: mimeType,
        original_name: file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 180),
        file_size: file.size,
        uploaded_by: user.sub,
        created_at: now,
        updated_at: now,
      };
      await db.collection('referral_documents').insertOne(document);
      documents.push({
        id: document.id,
        mime_type: document.mime_type,
        original_name: document.original_name,
        file_size: document.file_size,
        created_at: document.created_at,
      });
    }
    await notification(
      db,
      specialist.user_id,
      'referral_received',
      'New patient referral',
      'A doctor has referred a patient for your review.',
      { referral_id: referral.id },
    );
    await notification(
      db,
      patient.user_id,
      'referral_created',
      'Referral created',
      'Your care team has created a specialist referral.',
      { referral_id: referral.id },
    );
    await audit(db, req, referral.id, 'referral.created', {
      patient_id: patient.id,
      specialist_id: specialist.id,
      document_count: documents.length,
    });
    return { referral, documents };
  } catch (error) {
    if (db && storedKeys.length) {
      await db.collection('referral_documents')
        .deleteMany({ storage_key: { $in: storedKeys } })
        .catch(() => undefined);
    }
    await Promise.all(storedKeys.map((key) => storage.deleteObject(key).catch(() => undefined)));
    throw error;
  }
}

async function referralAction(input, files, user, req) {
  if (input.action === 'create') {
    if (files.length > 10) throw httpError(422, 'DOCUMENT_LIMIT_EXCEEDED', 'A referral can contain up to ten documents');
    return createReferral(input, files, user, req);
  }
  if (files.length) throw httpError(422, 'UNEXPECTED_DOCUMENTS', 'Documents are only accepted when creating a referral');

  const db = await getDb();
  const referral = await getReferral(db, input.referral_id);
  if (input.action === 'follow_up') {
    if (!['doctor', 'health_worker'].includes(user.role)) {
      throw httpError(403, 'FORBIDDEN', 'Only a doctor or assigned health worker can record follow-up');
    }
    await assignedPatient(db, referral.patient_id, user);
    if (user.role === 'doctor' && referral.referred_by !== user.sub) {
      throw httpError(403, 'FORBIDDEN', 'You may only follow up referrals you created');
    }
    if (new Date(`${input.follow_up_date}T23:59:59+05:30`) < new Date()) {
      throw httpError(422, 'FOLLOW_UP_IN_PAST', 'Follow-up date cannot be in the past');
    }
    const details = {
      follow_up_date: input.follow_up_date,
      follow_up_status: input.follow_up_status,
      notes: input.notes,
    };
    const now = new Date();
    await db.collection('referral_events').insertOne({
      id: randomUUID(),
      referral_id: referral.id,
      actor_id: user.sub,
      event_type: 'follow_up',
      details,
      created_at: now,
      updated_at: now,
    });
    await notification(
      db,
      referral.patient_user_id,
      'referral_follow_up',
      'Follow-up scheduled',
      `Your care team scheduled a follow-up for ${input.follow_up_date}.`,
      { referral_id: referral.id, ...details },
    );
    await audit(db, req, referral.id, 'referral.follow_up', details);
    return { referral_id: referral.id, follow_up: details };
  }

  if (input.action === 'update_status') {
    if (!['specialist', 'doctor', 'admin', 'super_admin'].includes(user.role)) {
      throw httpError(403, 'FORBIDDEN', 'You cannot update referral status');
    }
    if (user.role === 'specialist' && referral.specialist_user_id !== user.sub) {
      throw httpError(403, 'FORBIDDEN', 'This referral is assigned to another specialist');
    }
    if (user.role === 'doctor' && referral.referred_by !== user.sub) {
      throw httpError(403, 'FORBIDDEN', 'You may only update referrals you created');
    }
    const allowed = {
      pending: ['accepted', 'in_progress', 'rejected'],
      accepted: ['in_progress', 'completed', 'rejected'],
      in_review: ['in_progress', 'completed', 'rejected'],
      in_progress: ['completed', 'rejected'],
      completed: [],
      rejected: [],
    };
    if (!allowed[referral.status]?.includes(input.status)) {
      throw httpError(409, 'INVALID_REFERRAL_TRANSITION', `Referral cannot move from ${referral.status} to ${input.status}`);
    }
    const now = new Date();
    const update = await db.collection('referrals').updateOne(
      { id: referral.id, status: referral.status },
      { $set: { status: input.status, updated_at: now } },
    );
    if (!update.matchedCount) {
      throw httpError(409, 'INVALID_REFERRAL_TRANSITION', 'Referral status changed before this update could be applied');
    }
    const updatedReferral = { id: referral.id, status: input.status };
    await db.collection('referral_events').insertOne({
      id: randomUUID(),
      referral_id: referral.id,
      actor_id: user.sub,
      event_type: 'status_changed',
      details: { from: referral.status, to: input.status, note: input.note },
      created_at: now,
      updated_at: now,
    });
    await notification(
      db,
      referral.patient_user_id,
      'referral_status_updated',
      'Referral updated',
      `Your referral status is now ${input.status}.`,
      { referral_id: referral.id, status: input.status },
    );
    await notification(
      db,
      referral.referred_by,
      'referral_status_updated',
      'Referral updated',
      `A referral status is now ${input.status}.`,
      { referral_id: referral.id, status: input.status },
    );
    await audit(db, req, referral.id, 'referral.status_updated', {
      from: referral.status,
      to: input.status,
    });
    return { referral: updatedReferral };
  }

  if (input.action === 'specialist_feedback') {
    if (user.role !== 'specialist' || referral.specialist_user_id !== user.sub) {
      throw httpError(403, 'FORBIDDEN', 'Only the assigned specialist can provide feedback');
    }
    const feedbackData = {
      feedback: input.feedback,
      recommended_investigations: input.recommended_investigations,
    };
    const now = new Date();
    await db.collection('referrals').updateOne(
      { id: referral.id },
      { $set: { feedback: input.feedback, updated_at: now } },
    );
    await db.collection('referral_events').insertOne({
      id: randomUUID(),
      referral_id: referral.id,
      actor_id: user.sub,
      event_type: 'specialist_feedback',
      details: feedbackData,
      created_at: now,
      updated_at: now,
    });
    const feedbackReferral = { id: referral.id, feedback: input.feedback, status: referral.status };
    await notification(
      db,
      referral.referred_by,
      'specialist_feedback',
      'Specialist feedback received',
      'The specialist added feedback to your referral.',
      { referral_id: referral.id },
    );
    await notification(
      db,
      referral.patient_user_id,
      'specialist_feedback',
      'Referral feedback updated',
      'The specialist added information to your referral.',
      { referral_id: referral.id },
    );
    await audit(db, req, referral.id, 'referral.specialist_feedback', {
      recommended_investigations: input.recommended_investigations,
    });
    return { referral: feedbackReferral, feedback: feedbackData };
  }
  throw httpError(400, 'INVALID_REFERRAL_ACTION', 'Unsupported referral action');
}

async function getReferralDocument(documentId, user, req) {
  const db = await getDb();
  const document = await db.collection('referral_documents').findOne({ id: documentId });
  if (!document) throw httpError(404, 'DOCUMENT_NOT_FOUND', 'Referral document not found');
  const referral = await getReferral(db, document.referral_id);
  const accessRecord = { ...document, ...referral };
  if (!canAccess(accessRecord, user)) {
    throw httpError(403, 'FORBIDDEN', 'You cannot access this referral document');
  }
  if (user.role === 'health_worker') await assignedPatient(db, referral.patient_id, user);
  const buffer = await storage.decryptStoredImage(document);
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: user.sub,
    action: 'referral.document_downloaded',
    entity: 'referral_document',
    entity_id: document.id,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata: { referral_id: document.referral_id },
    created_at: new Date(),
  });
  return { buffer, mimeType: document.mime_type, filename: document.original_name };
}

async function listReferrals(query, user) {
  const db = await getDb();
  if (query.directory === 'true') {
    const [specialists, hospitals] = await Promise.all([
      db.collection('specialists').find({}).toArray(),
      db.collection('hospitals').find({ is_active: true }).sort({ name: 1 }).toArray(),
    ]);
    const activeUsers = await db.collection('users').find({
      id: { $in: specialists.map((specialist) => specialist.user_id) },
      is_active: true,
    }).toArray();
    const usersById = new Map(activeUsers.map((item) => [item.id, item]));
    return {
      directory: {
        specialists: specialists
          .filter((specialist) => usersById.has(specialist.user_id))
          .map((specialist) => ({
            id: specialist.id,
            specialty: specialist.specialty,
            hospital_id: specialist.hospital_id,
            name: usersById.get(specialist.user_id).full_name,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        hospitals: hospitals.map(({ id, name, address }) => ({ id, name, address })),
      },
      items: [],
    };
  }

  const paging = pagination(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.urgency) filter.urgency = query.urgency;
  if (query.hospital_id) filter.hospital_id = query.hospital_id;
  if (query.specialist_id) filter.referred_to_specialist_id = query.specialist_id;
  if (query.patient_id) filter.patient_id = query.patient_id;
  if (query.from || query.to) {
    filter.created_at = {};
    if (query.from) filter.created_at.$gte = dateStart(query.from);
    if (query.to) filter.created_at.$lt = dateAfter(query.to);
  }

  let scopedPatientIds;
  if (user.role === 'patient') {
    scopedPatientIds = (await db.collection('patients').find({
      user_id: user.sub,
    }).toArray()).map((patient) => patient.id);
  } else if (user.role === 'specialist') {
    const specialist = await db.collection('specialists').findOne({ user_id: user.sub });
    if (!specialist) return emptyPage(paging);
    if (query.specialist_id && query.specialist_id !== specialist.id) return emptyPage(paging);
    filter.referred_to_specialist_id = specialist.id;
  } else if (user.role === 'doctor') {
    filter.referred_by = user.sub;
  } else if (user.role === 'health_worker') {
    const worker = await db.collection('health_workers').findOne({ user_id: user.sub });
    const patientFilter = { is_active: true, deleted_at: null };
    if (worker?.phc_id || worker?.village_id) {
      patientFilter.$or = [
        ...(worker.phc_id ? [{ phc_id: worker.phc_id }] : []),
        ...(worker.village_id ? [{ village_id: worker.village_id }] : []),
      ];
    } else {
      scopedPatientIds = [];
    }
    if (scopedPatientIds === undefined) {
      scopedPatientIds = (await db.collection('patients').find(patientFilter).toArray()).map((patient) => patient.id);
    }
  }
  if (scopedPatientIds) {
    if (query.patient_id && !scopedPatientIds.includes(query.patient_id)) return emptyPage(paging);
    if (!scopedPatientIds.length) return emptyPage(paging);
    filter.patient_id = { $in: scopedPatientIds };
  }

  const referrals = await db.collection('referrals').find(filter)
    .sort({ created_at: -1, id: 1 })
    .toArray();
  const items = [];
  for (const referral of referrals) {
    const patient = await db.collection('patients').findOne({ id: referral.patient_id });
    if (!patient) continue;
    const [specialist, hospital, events, documents] = await Promise.all([
      referral.referred_to_specialist_id
        ? db.collection('specialists').findOne({ id: referral.referred_to_specialist_id })
        : null,
      referral.hospital_id ? db.collection('hospitals').findOne({ id: referral.hospital_id }) : null,
      db.collection('referral_events').find({ referral_id: referral.id })
        .sort({ created_at: 1, id: 1 }).toArray(),
      db.collection('referral_documents').find({ referral_id: referral.id })
        .sort({ created_at: 1, id: 1 }).toArray(),
    ]);
    const [specialistUser, actors] = await Promise.all([
      specialist ? db.collection('users').findOne({ id: specialist.user_id }) : null,
      events.length
        ? db.collection('users').find({ id: { $in: events.map((event) => event.actor_id).filter(Boolean) } }).toArray()
        : [],
    ]);
    const actorsById = new Map(actors.map((actor) => [actor.id, actor]));
    items.push({
      id: referral.id,
      patient_id: referral.patient_id,
      screening_id: referral.screening_id,
      referred_by: referral.referred_by,
      referred_to_specialist_id: referral.referred_to_specialist_id,
      hospital_id: referral.hospital_id,
      status: referral.status,
      reason: referral.reason,
      urgency: referral.urgency,
      feedback: referral.feedback,
      created_at: referral.created_at,
      updated_at: referral.updated_at,
      patient_code: patient.patient_code,
      patient_name: patient.full_name,
      specialty: specialist?.specialty,
      specialist_name: specialistUser?.full_name,
      hospital_name: hospital?.name,
      timeline: events.map((event) => ({
        id: event.id,
        event_type: event.event_type,
        details: event.details,
        created_at: event.created_at,
        actor_name: actorsById.get(event.actor_id)?.full_name,
      })),
      documents: documents.map((document) => ({
        id: document.id,
        mime_type: document.mime_type,
        original_name: document.original_name,
        file_size: document.file_size,
        created_at: document.created_at,
      })),
    });
  }
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || a.id.localeCompare(b.id));
  const total = items.length;
  return {
    items: items.slice(paging.offset, paging.offset + paging.limit),
    meta: {
      page: paging.page,
      limit: paging.limit,
      total,
      totalPages: Math.ceil(total / paging.limit),
    },
  };
}

function emptyPage(paging) {
  return {
    items: [],
    meta: { page: paging.page, limit: paging.limit, total: 0, totalPages: 0 },
  };
}

module.exports = { referralAction, listReferrals, getReferralDocument, fileType };
