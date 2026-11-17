const { randomUUID } = require('node:crypto');
const { getDb } = require('../db/mongo');
const patientService = require('../patients/service');
const imageStorage = require('../adapters/privateImageStorage');
const geminiScreening = require('../adapters/geminiScreening');
const visionProvider = require('../adapters/screeningVisionProvider');
const notificationService = require('../services/notificationService');
const { prepareImage } = require('./imageQuality');
const logger = require('../utils/logger');
const getNotificationCopy = require('../notifications/phase8Copy');

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

async function audit(db, req, screeningId, action, metadata = {}) {
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: req.user.sub,
    action,
    entity: 'oral_screening',
    entity_id: screeningId,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata,
    created_at: new Date(),
  });
}

async function patientAssignment(db, patientId, user) {
  if (user.role !== 'health_worker') return;
  const [patient, worker] = await Promise.all([
    db.collection('patients').findOne({ id: patientId }),
    db.collection('health_workers').findOne({ user_id: user.sub }),
  ]);
  if (
    !patient ||
    !worker ||
    !(
      (worker.phc_id && worker.phc_id === patient.phc_id) ||
      (worker.village_id && worker.village_id === patient.village_id)
    )
  ) {
    throw httpError(403, 'OUTSIDE_ASSIGNED_AREA', 'Patient is outside your assigned area');
  }
}

async function assertDataCollectionConsent(db, patientId) {
  const consent = await db.collection('patient_consents').findOne({
    patient_id: patientId,
    consent_type: 'data_collection',
  });
  if (!consent?.granted) {
    throw httpError(
      422,
      'DATA_COLLECTION_CONSENT_REQUIRED',
      'Active data-collection consent is required before screening',
    );
  }
}

async function assertScreeningAccess(db, screeningId, user) {
  const screening = await db.collection('oral_screenings').findOne({ id: screeningId });
  if (!screening) throw httpError(404, 'SCREENING_NOT_FOUND', 'Screening not found');
  const patient = await db.collection('patients').findOne({ id: screening.patient_id });
  if (!patient || !patient.is_active || patient.deleted_at) {
    throw httpError(404, 'SCREENING_NOT_FOUND', 'Screening not found');
  }
  if (user.role === 'patient' && patient.user_id !== user.sub) {
    throw httpError(403, 'FORBIDDEN', 'You may only access your own screenings');
  }
  if (user.role === 'doctor') await patientService.assertPatientScope(patient.id, user);
  if (user.role === 'health_worker') await patientAssignment(db, screening.patient_id, user);
  if (user.role === 'specialist') {
    const specialist = await db.collection('specialists').findOne({ user_id: user.sub });
    const referral =
      specialist &&
      (await db.collection('referrals').findOne({
        screening_id: screeningId,
        referred_to_specialist_id: specialist.id,
      }));
    if (!referral) {
      throw httpError(403, 'FORBIDDEN', 'Screening is not referred to this specialist');
    }
  }
  return { ...patient, ...screening, id: screening.id, patient_id: screening.patient_id };
}

function pagination(query) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw httpError(
      400,
      'INVALID_PAGINATION',
      'page must be positive and limit must be between 1 and 100',
    );
  }
  return { page, limit, offset: (page - 1) * limit };
}

function dayStart(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function nextDay(value) {
  const date = dayStart(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function includesText(value, term) {
  return String(value || '')
    .toLocaleLowerCase()
    .includes(String(term).toLocaleLowerCase());
}

async function createScreening(input, req) {
  const db = await getDb();
  const screenings = db.collection('oral_screenings');
  const existing = await screenings.findOne({ client_uuid: input.client_uuid });
  const patient = await db.collection('patients').findOne({ id: input.patient_id });
  if (!patient || !patient.is_active || patient.deleted_at) {
    throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
  }
  if (req.user.role === 'patient' && patient.user_id !== req.user.sub) {
    throw httpError(403, 'FORBIDDEN', 'You may only create screenings for yourself');
  }
  await patientAssignment(db, patient.id, req.user);
  if (req.user.role === 'doctor') await patientService.assertPatientScope(patient.id, req.user);
  if (existing) {
    if (existing.screened_by !== req.user.sub || existing.patient_id !== patient.id) {
      throw httpError(
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'This screening key is already associated with another record',
      );
    }
    return { screening: existing, created: false };
  }
  await assertDataCollectionConsent(db, patient.id);
  const now = new Date();
  const screening = {
    id: randomUUID(),
    patient_id: patient.id,
    screened_by: req.user.sub,
    phc_id: patient.phc_id || null,
    status: 'draft',
    notes: input.notes,
    client_uuid: input.client_uuid,
    screened_at: now,
    created_at: now,
    updated_at: now,
  };
  await screenings.insertOne(screening);
  if (input.symptoms.length) {
    await db.collection('symptoms').insertMany(
      input.symptoms.map((symptom) => ({
        id: randomUUID(),
        patient_id: patient.id,
        screening_id: screening.id,
        recorded_by: req.user.sub,
        symptom_code: symptom.code,
        severity: symptom.severity,
        duration_days: symptom.duration_days,
        entered_via: symptom.entered_via,
        symptom_codes: [symptom.code],
        created_at: now,
        updated_at: now,
      })),
    );
  }
  await audit(db, req, screening.id, 'screening.created', {
    patient_id: patient.id,
    symptom_count: input.symptoms.length,
    client_uuid: input.client_uuid,
  });
  return { screening, created: true };
}

async function listScreenings(query, user) {
  const paging = pagination(query);
  const db = await getDb();
  const [allPatients, allScreenings] = await Promise.all([
    db.collection('patients').find({ is_active: true, deleted_at: null }).toArray(),
    db.collection('oral_screenings').find({}).toArray(),
  ]);
  const patientsById = new Map(allPatients.map((patient) => [patient.id, patient]));
  let candidates = allScreenings.filter((screening) => patientsById.has(screening.patient_id));

  if (user.role === 'patient') {
    const ownPatientIds = new Set(
      allPatients.filter((p) => p.user_id === user.sub).map((p) => p.id),
    );
    candidates = candidates.filter((screening) => ownPatientIds.has(screening.patient_id));
  } else if (user.role === 'health_worker') {
    const worker = await db.collection('health_workers').findOne({ user_id: user.sub });
    candidates = candidates.filter((screening) => {
      const patient = patientsById.get(screening.patient_id);
      return (
        worker &&
        ((worker.phc_id && worker.phc_id === patient.phc_id) ||
          (worker.village_id && worker.village_id === patient.village_id))
      );
    });
  } else if (user.role === 'specialist') {
    const specialist = await db.collection('specialists').findOne({ user_id: user.sub });
    if (!specialist) candidates = [];
    else {
      const referrals = await db
        .collection('referrals')
        .find({ referred_to_specialist_id: specialist.id })
        .toArray();
      const screeningIds = new Set(referrals.map((referral) => referral.screening_id));
      candidates = candidates.filter((screening) => screeningIds.has(screening.id));
    }
  } else if (user.role === 'doctor') {
    const assigned = new Set(await patientService.assignedPatientIds(db, user.sub));
    candidates = candidates.filter((screening) => assigned.has(screening.patient_id));
  }

  if (query.patient_id) candidates = candidates.filter((s) => s.patient_id === query.patient_id);
  if (query.status) candidates = candidates.filter((s) => s.status === query.status);
  if (query.from)
    candidates = candidates.filter((s) => new Date(s.screened_at) >= dayStart(query.from));
  if (query.to) candidates = candidates.filter((s) => new Date(s.screened_at) < nextDay(query.to));

  const villages = await db.collection('villages').find({}).toArray();
  const phcs = await db.collection('phcs').find({}).toArray();
  const villageNames = new Map(villages.map((village) => [village.id, village.name]));
  const phcNames = new Map(phcs.map((phc) => [phc.id, phc.name]));
  const rows = [];
  for (const screening of candidates) {
    const patient = patientsById.get(screening.patient_id);
    const latestAi = await db
      .collection('ai_screening_results')
      .find({ screening_id: screening.id })
      .sort({ created_at: -1 })
      .limit(1)
      .next();
    const villageName = villageNames.get(patient.village_id) || patient.village_name || null;
    const phcName = phcNames.get(patient.phc_id) || patient.phc_name || null;

    if (query.village && !includesText(villageName, query.village)) continue;
    if (query.phc && !includesText(phcName, query.phc)) continue;
    rows.push({
      id: screening.id,
      patient_id: screening.patient_id,
      status: screening.status,
      screened_at: screening.screened_at,
      created_at: screening.created_at,
      notes: screening.notes,
      patient_code: patient.patient_code,
      patient_name: patient.full_name,
      village_name: villageName,
      phc_name: phcName,
      risk_category: null,
      is_demo: latestAi?.is_demo ?? null,
      inference_status:
        latestAi?.inference_status || (latestAi?.is_demo ? 'not_performed' : 'unknown'),
    });
  }
  rows.sort(
    (a, b) => new Date(b.screened_at) - new Date(a.screened_at) || a.id.localeCompare(b.id),
  );
  if (query.search) {
    const search = query.search.toLocaleLowerCase();
    const matches = (value) => String(value || '').toLocaleLowerCase().includes(search);
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (![row.patient_name, row.patient_code, row.village_name, row.phc_name].some(matches)) {
        rows.splice(index, 1);
      }
    }
  }
  const total = rows.length;
  return {
    items: rows.slice(paging.offset, paging.offset + paging.limit),
    meta: {
      page: paging.page,
      limit: paging.limit,
      total,
      totalPages: Math.ceil(total / paging.limit),
    },
  };
}

async function screeningDetail(screeningId, user, req) {
  const db = await getDb();
  const screening = await assertScreeningAccess(db, screeningId, user);
  await audit(db, req, screeningId, 'screening.record.accessed', {
    patient_id: screening.patient_id,
  });
  const [patient, symptoms, images, aiResults, reviews, referrals, history] = await Promise.all([
    db.collection('patients').findOne({ id: screening.patient_id }),
    db
      .collection('symptoms')
      .find({ screening_id: screeningId })
      .sort({ created_at: 1, id: 1 })
      .toArray(),
    db
      .collection('oral_images')
      .find({ screening_id: screeningId })
      .sort({ created_at: 1, id: 1 })
      .toArray(),
    db
      .collection('ai_screening_results')
      .find({ screening_id: screeningId })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray(),
    db
      .collection('clinical_reviews')
      .find({ screening_id: screeningId })
      .sort({ reviewed_at: -1 })
      .toArray(),
    db
      .collection('referrals')
      .find({ screening_id: screeningId })
      .sort({ created_at: -1 })
      .toArray(),
    db.collection('medical_histories').findOne({ patient_id: screening.patient_id }),
  ]);
  const [village, phc, users] = await Promise.all([
    patient.village_id ? db.collection('villages').findOne({ id: patient.village_id }) : null,
    patient.phc_id ? db.collection('phcs').findOne({ id: patient.phc_id }) : null,
    reviews.length
      ? db
          .collection('users')
          .find({ id: { $in: reviews.map((review) => review.reviewer_id) } })
          .toArray()
      : [],
  ]);
  const usersById = new Map(users.map((item) => [item.id, item]));
  const patientSummary = {
    id: patient.id,
    patient_code: patient.patient_code,
    full_name: patient.full_name,
    age: patient.age,
    gender: patient.gender,
    district: patient.district,
    mandal: patient.mandal,
    village_name: village?.name || patient.village_name || null,
    phc_name: phc?.name || patient.phc_name || null,
  };
  const patientHistory = history && {
    conditions: history.conditions,
    allergies: history.allergies,
    current_medications: history.current_medications,
    tobacco_use: history.tobacco_use,
    gutkha_use: history.gutkha_use,
    areca_nut_use: history.areca_nut_use,
  };
  const aiResult = aiResults[0] && {
    id: aiResults[0].id,
    risk_category: null,
    confidence: null,
    model_provider: aiResults[0].model_provider || null,
    model_version: aiResults[0].model_version,
    inference_status:
      aiResults[0].inference_status || (aiResults[0].is_demo ? 'not_performed' : 'unknown'),
    analysis_timestamp: aiResults[0].analysis_timestamp || aiResults[0].created_at,
    is_demo: aiResults[0].is_demo,
    disclaimer: aiResults[0].disclaimer,
    result_data: aiResults[0].result_data,
    created_at: aiResults[0].created_at,
  };
  const aiProcessingConsent = await db.collection('patient_consents').findOne({
    patient_id: screening.patient_id,
    consent_type: 'ai_processing',
  });
  const doctorRequest = await db
    .collection('screening_doctor_requests')
    .find({ screening_id: screeningId })
    .sort({ created_at: -1 })
    .limit(1)
    .next();
  const requestedDoctor = doctorRequest
    ? await db.collection('doctors').findOne({ id: doctorRequest.doctor_id })
    : null;
  const requestedDoctorUser = requestedDoctor
    ? await db.collection('users').findOne({ id: requestedDoctor.user_id })
    : null;

  if (req.query.image_id) {
    const image = await db.collection('oral_images').findOne({
      id: req.query.image_id,
      screening_id: screeningId,
    });
    if (!image) throw httpError(404, 'IMAGE_NOT_FOUND', 'Image not found');
    const buffer = await imageStorage.decryptStoredImage(image);
    await audit(db, req, screeningId, 'screening.image_viewed', { image_id: image.id });
    return { stream: { buffer, mimeType: image.image_mime_type, imageId: image.id } };
  }

  return {
    screening: {
      id: screening.id,
      status: screening.status,
      notes: screening.notes,
      screened_at: screening.screened_at,
      created_at: screening.created_at,
      patient: patientSummary,
      patient_history: patientHistory || null,
      symptoms: symptoms.map((item) => ({
        id: item.id,
        symptom_code: item.symptom_code,
        severity: item.severity,
        duration_days: item.duration_days,
        entered_via: item.entered_via,
        created_at: item.created_at,
      })),
      images: images.map((item) => ({
        id: item.id,
        site: item.site,
        image_mime_type: item.image_mime_type,
        quality_score: item.quality_score,
        quality_status: item.quality_status,
        quality_notes: item.quality_notes,
        width: item.width,
        height: item.height,
        created_at: item.created_at,
      })),
      ai_result: aiResult || null,
      ai_processing_consent_granted: Boolean(aiProcessingConsent?.granted),
      ai_processing_consent_version: aiProcessingConsent?.version || 1,
      ai_provider_configured: visionProvider.isConfigured(),
      doctor_request: doctorRequest
        ? {
            id: doctorRequest.id,
            doctor_id: doctorRequest.doctor_id,
            doctor_name: requestedDoctorUser?.full_name || null,
            status: doctorRequest.status,
            submitted_at: doctorRequest.created_at,
            updated_at: doctorRequest.updated_at,
            responded_at: doctorRequest.responded_at || null,
          }
        : null,
      clinical_reviews: reviews.map((item) => ({
        id: item.id,
        review_status: item.review_status,
        reviewer_role: item.reviewer_role,
        observations: item.observations,
        provisional_notes: item.provisional_notes,
        follow_up_recommendation: item.follow_up_recommendation || null,
        follow_up_date: item.follow_up_date || null,
        recommend_referral: item.recommend_referral,
        recommended_investigations: item.recommended_investigations,
        ai_observation_decisions: item.ai_observation_decisions || [],
        reviewed_at: item.reviewed_at,
        reviewer_name: usersById.get(item.reviewer_id)?.full_name,
      })),
      referrals: referrals.map((item) => ({
        id: item.id,
        status: item.status,
        urgency: item.urgency,
        reason: item.reason,
        feedback: item.feedback,
      })),
    },
  };
}

async function availableDoctors(user) {
  if (user.role !== 'patient') {
    throw httpError(403, 'FORBIDDEN', 'Only patients may choose a doctor for their screening');
  }
  const db = await getDb();
  const patient = await db.collection('patients').findOne({
    user_id: user.sub,
    is_active: true,
    deleted_at: null,
  });
  if (!patient) throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient profile not found');
  const doctors = await db.collection('doctors').find({}).toArray();
  const items = [];
  for (const doctor of doctors) {
    if (doctor.is_active === false) continue;
    const doctorUser = await db.collection('users').findOne({
      id: doctor.user_id,
      role: 'doctor',
      is_active: true,
      deleted_at: null,
    });
    if (!doctorUser) continue;
    items.push({
      id: doctor.id,
      full_name: doctorUser.full_name,
      specialty: doctor.specialty || null,
    });
  }
  return items.sort((left, right) => left.full_name.localeCompare(right.full_name));
}

async function createDoctorRequest(screeningId, doctorId, user, req) {
  const db = await getDb();
  const screening = await assertScreeningAccess(db, screeningId, user);
  if (user.role !== 'patient') {
    throw httpError(403, 'FORBIDDEN', 'Only the patient may send their screening to a doctor');
  }
  await assertDataCollectionConsent(db, screening.patient_id);
  const photoConsent = await db.collection('patient_consents').findOne({
    patient_id: screening.patient_id,
    consent_type: 'photo',
    granted: true,
  });
  if (!photoConsent) {
    throw httpError(
      403,
      'PHOTO_CONSENT_REQUIRED',
      'Active photo consent is required to share screening images',
    );
  }
  const imageCount = await db
    .collection('oral_images')
    .countDocuments({ screening_id: screeningId });
  if (!imageCount) {
    throw httpError(
      422,
      'SCREENING_IMAGES_REQUIRED',
      'Upload at least one photo before requesting doctor review',
    );
  }
  const doctor = await db.collection('doctors').findOne({ id: doctorId });
  const doctorUser =
    doctor &&
    (await db.collection('users').findOne({
      id: doctor.user_id,
      role: 'doctor',
      is_active: true,
      deleted_at: null,
    }));
  if (!doctor || doctor.is_active === false || !doctorUser) {
    throw httpError(404, 'DOCTOR_NOT_AVAILABLE', 'The selected doctor is not available');
  }

  const requests = db.collection('screening_doctor_requests');
  const existing = await requests.findOne({ screening_id: screeningId });
  if (existing) {
    if (existing.doctor_id !== doctorId) {
      throw httpError(
        409,
        'DOCTOR_REQUEST_ALREADY_ASSIGNED',
        'This screening has already been sent to a doctor',
      );
    }
    return { request: existing, created: false };
  }

  const now = new Date();
  const request = {
    id: randomUUID(),
    screening_id: screeningId,
    patient_id: screening.patient_id,
    doctor_id: doctor.id,
    doctor_user_id: doctorUser.id,
    status: 'submitted',
    created_at: now,
    updated_at: now,
  };
  try {
    await requests.insertOne(request);
  } catch (error) {
    if (error.code !== 11000) throw error;
    const winner = await requests.findOne({ screening_id: screeningId });
    if (winner?.doctor_id === doctorId) return { request: winner, created: false };
    throw httpError(
      409,
      'DOCTOR_REQUEST_ALREADY_ASSIGNED',
      'This screening has already been sent to a doctor',
    );
  }

  await audit(db, req, screeningId, 'screening.doctor_request.created', {
    request_id: request.id,
    doctor_id: doctor.id,
    image_count: imageCount,
  });
  await notificationService.create(
    db,
    doctorUser.id,
    'consultation',
    { screening_id: screeningId },
    {
      type: 'consultation',
      title: 'New screening request',
      body: 'A patient shared an oral screening for your review.',
      allowedChannels: ['in_app'],
    },
  );
  return { request, created: true };
}

async function listDoctorRequests(user) {
  const db = await getDb();
  let filter;
  if (user.role === 'patient') {
    const patient = await db.collection('patients').findOne({
      user_id: user.sub,
      is_active: true,
      deleted_at: null,
    });
    if (!patient) throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient profile not found');
    filter = { patient_id: patient.id };
  } else if (user.role === 'doctor') {
    const doctor = await db.collection('doctors').findOne({ user_id: user.sub });
    if (!doctor) throw httpError(403, 'FORBIDDEN', 'Doctor profile not found');
    filter = { doctor_id: doctor.id };
  } else {
    throw httpError(403, 'FORBIDDEN', 'You cannot access screening doctor requests');
  }
  const requests = await db
    .collection('screening_doctor_requests')
    .find(filter)
    .sort({ created_at: -1 })
    .limit(100)
    .toArray();
  const items = [];
  for (const request of requests) {
    const [patient, screening, doctor] = await Promise.all([
      db.collection('patients').findOne({ id: request.patient_id }),
      db.collection('oral_screenings').findOne({ id: request.screening_id }),
      db.collection('doctors').findOne({ id: request.doctor_id }),
    ]);
    const doctorUser = doctor && (await db.collection('users').findOne({ id: doctor.user_id }));
    items.push({
      id: request.id,
      screening_id: request.screening_id,
      patient_id: request.patient_id,
      doctor_id: request.doctor_id,
      patient_name: patient?.full_name || null,
      patient_code: patient?.patient_code || null,
      doctor_name: doctorUser?.full_name || null,
      screening_status: screening?.status || null,
      status: request.status,
      submitted_at: request.created_at,
      updated_at: request.updated_at,
      responded_at: request.responded_at || null,
    });
  }
  return items;
}

async function updateDoctorRequestStatus(screeningId, status, user, req) {
  const db = await getDb();
  const screening = await assertScreeningAccess(db, screeningId, user);
  if (user.role !== 'doctor' || status !== 'under_review') {
    throw httpError(403, 'FORBIDDEN', 'Only the assigned doctor may update this request');
  }
  const doctor = await db.collection('doctors').findOne({ user_id: user.sub });
  const request =
    doctor &&
    (await db.collection('screening_doctor_requests').findOne({
      screening_id: screeningId,
      patient_id: screening.patient_id,
      doctor_id: doctor.id,
    }));
  if (!request) throw httpError(404, 'DOCTOR_REQUEST_NOT_FOUND', 'Screening request not found');
  if (request.status === status) return request;
  if (request.status !== 'submitted') {
    throw httpError(
      409,
      'DOCTOR_REQUEST_STATUS_INVALID',
      'This screening request cannot be moved to review',
    );
  }
  const now = new Date();
  const changed = await db
    .collection('screening_doctor_requests')
    .updateOne({ id: request.id, status: 'submitted' }, { $set: { status, updated_at: now } });
  if (!changed.modifiedCount) {
    throw httpError(409, 'DOCTOR_REQUEST_STATUS_CHANGED', 'The screening request status changed');
  }
  await audit(db, req, screeningId, 'screening.doctor_request.review_started', {
    request_id: request.id,
    doctor_id: doctor.id,
  });
  return { ...request, status, updated_at: now };
}

function qualityError(images) {
  return httpError(
    422,
    'LOW_IMAGE_QUALITY',
    'Image quality is low. Retake the image using the guidance, or explicitly accept the low-quality image.',
    {
      images: images.map(({ qualityScore, qualityNotes, width, height }) => ({
        quality_score: qualityScore,
        quality_notes: qualityNotes,
        width,
        height,
      })),
      advice: 'Use bright even light, hold the camera steady, and frame the mouth clearly.',
    },
  );
}

async function uploadImages(screeningId, files, { site, acceptLowQuality }, user, req) {
  const storedKeys = [];
  try {
    const db = await getDb();
    const screening = await assertScreeningAccess(db, screeningId, user);
    if (!['doctor', 'health_worker', 'patient'].includes(user.role)) {
      throw httpError(403, 'FORBIDDEN', 'You cannot upload screening images');
    }
    await assertDataCollectionConsent(db, screening.patient_id);
    const consent = await db.collection('patient_consents').findOne({
      patient_id: screening.patient_id,
      consent_type: 'photo',
    });
    if (!consent?.granted) {
      throw httpError(
        403,
        'PHOTO_CONSENT_REQUIRED',
        'Active photo consent is required before uploading an image',
      );
    }
    const imageCollection = db.collection('oral_images');
    if ((await imageCollection.countDocuments({ screening_id: screeningId })) + files.length > 6) {
      throw httpError(422, 'IMAGE_LIMIT_EXCEEDED', 'A screening can contain up to six images');
    }
    const prepared = [];
    for (const file of files) prepared.push(await prepareImage(file.buffer, file.mimetype));
    const lowQuality = prepared.filter(
      (image) => image.qualityNotes.length > 0 || image.qualityScore < 0.5,
    );
    if (lowQuality.length && (!acceptLowQuality || user.role === 'patient')) {
      throw qualityError(lowQuality);
    }

    const now = new Date();
    const insertedImages = [];
    for (const image of prepared) {
      const encrypted = await imageStorage.encryptAndStore(image.buffer);
      storedKeys.push(encrypted.storage_key);
      const row = {
        id: randomUUID(),
        screening_id: screeningId,
        storage_key: encrypted.storage_key,
        encryption_algorithm: encrypted.encryption_algorithm,
        encryption_key_id: encrypted.encryption_key_id,
        encryption_iv: encrypted.encryption_iv,
        encryption_auth_tag: encrypted.encryption_auth_tag,
        content_hash: encrypted.content_hash,
        quality_score: image.qualityScore,
        quality_status: 'accepted',
        quality_notes: image.qualityNotes,
        width: image.width,
        height: image.height,
        image_mime_type: image.mimeType,
        site,
        uploaded_by: user.sub,
        created_at: now,
        updated_at: now,
      };
      await imageCollection.insertOne(row);
      insertedImages.push({
        id: row.id,
        site: row.site,
        image_mime_type: row.image_mime_type,
        quality_score: row.quality_score,
        quality_status: row.quality_status,
        quality_notes: row.quality_notes,
        width: row.width,
        height: row.height,
        created_at: row.created_at,
      });
    }
    await db
      .collection('oral_screenings')
      .updateOne({ id: screeningId }, { $set: { status: 'images_uploaded', updated_at: now } });
    await audit(db, req, screeningId, 'screening.images_uploaded', {
      count: insertedImages.length,
      site,
      accepted_low_quality: Boolean(lowQuality.length && acceptLowQuality),
    });
    return { images: insertedImages };
  } catch (error) {
    for (const key of storedKeys) {
      try {
        await imageStorage.deleteObject(key);
      } catch (cleanupError) {
        logger.error('Failed to remove an uncommitted screening image', {
          storageKey: key,
          error: cleanupError.message,
        });
      }
    }
    throw error;
  }
}

async function insertNotification(db, userId, data) {
  if (!userId) return;
  const user = await db.collection('users').findOne({ id: userId });
  if (!user) return;
  const [title, body] = getNotificationCopy(user.preferred_language || 'en', 'referral_received');
  await db.collection('notifications').insertOne({
    id: randomUUID(),
    user_id: userId,
    notification_type: 'referral',
    title,
    body,
    data,
    read_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
}

async function runAiAnalysis(screeningId, user, req) {
  const db = await getDb();
  const screening = await assertScreeningAccess(db, screeningId, user);
  await assertDataCollectionConsent(db, screening.patient_id);
  const [symptoms, history, images] = await Promise.all([
    db
      .collection('symptoms')
      .find({ screening_id: screeningId })
      .sort({ created_at: 1, id: 1 })
      .toArray(),
    db.collection('medical_histories').findOne({ patient_id: screening.patient_id }),
    db.collection('oral_images').find({ screening_id: screeningId }).toArray(),
    db.collection('patients').findOne({ id: screening.patient_id }),
  ]);
  const reportedSymptoms = symptoms.map((item) => ({
    code: item.symptom_code,
    severity: item.severity,
    duration_days: item.duration_days,
  }));
  const riskFactors = {
    tobacco_use: Boolean(history?.tobacco_use),
    gutkha_use: Boolean(history?.gutkha_use),
    areca_nut_use: Boolean(history?.areca_nut_use),
  };
  let result;
  let modelProvider = null;
  let inferenceStatus = 'not_performed';
  const usingVision = visionProvider.isConfigured();
  if (usingVision) {
    const consent = await db.collection('patient_consents').findOne({
      patient_id: screening.patient_id,
      consent_type: 'ai_processing',
      granted: true,
    });
    if (!consent) {
      throw httpError(
        403,
        'AI_PROCESSING_CONSENT_REQUIRED',
        'The patient must consent to sending screening images to Google Gemini before analysis',
      );
    }
    if (!images.length)
      throw httpError(422, 'AI_IMAGES_REQUIRED', 'Upload at least one oral image before analysis');
    const providerImages = [];
    let totalBytes = 0;
    for (const image of images) {
      const buffer = await imageStorage.decryptStoredImage(image);
      totalBytes += buffer.length;
      if (totalBytes > geminiScreening.MAX_IMAGE_BYTES)
        throw httpError(
          413,
          'AI_IMAGES_TOO_LARGE',
          'Select fewer or smaller images for AI analysis',
        );
      providerImages.push({
        buffer,
        mime_type: image.image_mime_type,
        site: image.site,
        quality_score: image.quality_score,
        quality_notes: image.quality_notes || [],
        width: image.width,
        height: image.height,
      });
    }
    modelProvider = 'Gemini';
    const objectiveQualityNotes = [
      ...new Set(images.flatMap((image) => image.quality_notes || [])),
    ];
    const objectiveQualityLow =
      objectiveQualityNotes.length > 0 ||
      images.some(
        (image) => Number(image.quality_score) < 0.5 || image.quality_status === 'needs_retake',
      );
    await audit(db, req, screeningId, 'screening.vision_inference_requested', {
      image_count: providerImages.length,
      consent_version: consent.version,
      model_provider: modelProvider,
      model_version: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      skipped_for_quality: objectiveQualityLow,
    });
    if (objectiveQualityLow) {
      inferenceStatus = 'inconclusive';
      result = {
        risk_category: null,
        confidence: null,
        model_provider: modelProvider,
        model_version: null,
        is_demo: false,
        disclaimer:
          'PRELIMINARY VISUAL OBSERVATIONS ONLY; NOT CLINICALLY VALIDATED OR A DIAGNOSIS.',
        result_data: {
          source: 'vision_inconclusive',
          analysis_status: 'inconclusive',
          image_analyzed: false,
          oral_region_detected: null,
          image_limitations: [
            'Image quality checks indicate that the uploaded image may not support reliable visual review.',
          ],
          uncertainty: ['No image findings were produced because image quality was insufficient.'],
          model_provider: modelProvider,
          clinical_validation_status: 'not_validated',
          image_quality: {
            status: 'needs_retake',
            concerns: objectiveQualityNotes,
            explanation:
              'Local image quality checks found limitations. Visual inference was not run.',
          },
          visible_observations: [],
          reported_symptoms: reportedSymptoms,
          reported_risk_factors: riskFactors,
          explanation:
            'Image analysis was inconclusive. Please retake the image and have persistent or concerning symptoms reviewed by a qualified clinician.',
          recommended_next_steps: [
            'Retake the image with bright, even lighting and a steady camera.',
            'Arrange a qualified clinical examination for persistent or concerning symptoms.',
          ],
          medical_limitations:
            'This general-purpose model is not clinically validated for oral disease screening and cannot diagnose, confirm, or rule out disease.',
        },
      };
    } else {
      let providerResult;
      try {
        providerResult = await visionProvider.analyze({ images: providerImages });
      } catch (error) {
        const failedAt = new Date();
        const failedResult = {
          id: randomUUID(),
          screening_id: screeningId,
          risk_category: null,
          confidence: null,
          model_provider: modelProvider,
          model_version: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
          inference_status: 'failed',
          analysis_timestamp: failedAt,
          is_demo: false,
          disclaimer: 'Image analysis did not complete.',
          result_data: {
            source: 'vision_inference',
            analysis_status: 'unavailable',
            image_analyzed: false,
            visible_observations: [],
            image_quality: {
              status: objectiveQualityNotes.length ? 'needs_retake' : 'locally_checked',
              concerns: objectiveQualityNotes,
              explanation:
                'Local image checks completed. Model inference failed, so no visual findings were produced.',
            },
            image_limitations: ['Image inference did not complete.'],
            uncertainty: ['No image findings are available because inference failed.'],
            reported_symptoms: reportedSymptoms,
            medical_limitations:
              'No image-based result was generated. Arrange clinical review for persistent or concerning symptoms.',
            recommended_next_steps: [
              'Retry image analysis later or arrange a qualified clinical examination.',
            ],
            inference_error_code: error.code || 'VISION_INFERENCE_FAILED',
          },
          created_at: failedAt,
          updated_at: failedAt,
        };
        await db.collection('ai_screening_results').insertOne(failedResult);
        await db
          .collection('oral_screenings')
          .updateOne(
            { id: screeningId },
            { $set: { status: 'analysis_failed', updated_at: failedAt } },
          );
        await audit(db, req, screeningId, 'screening.vision_inference_failed', {
          model_provider: modelProvider,
          error_code: error.code || 'VISION_INFERENCE_FAILED',
        });
        throw error;
      }
      const report = providerResult.report;
      inferenceStatus =
        report.analysis_status === 'completed' && report.image_analyzed
          ? 'completed'
          : 'inconclusive';
      const imageLimitations = [
        ...new Set([...report.image_limitations, ...objectiveQualityNotes]),
      ];
      result = {
        risk_category: null,
        confidence: null,
        model_provider: providerResult.model_provider,
        model_version: providerResult.model_version,
        is_demo: false,
        disclaimer:
          'PRELIMINARY VISUAL OBSERVATIONS ONLY; NOT CLINICALLY VALIDATED OR A DIAGNOSIS.',
        result_data: {
          source: 'vision_inference',
          analysis_status: inferenceStatus,
          image_analyzed: Boolean(report.image_analyzed),
          oral_region_detected: report.oral_region_detected,
          image_limitations: imageLimitations,
          uncertainty: report.uncertainty,
          model_provider: providerResult.model_provider,
          clinical_validation_status: report.clinical_validation_status,
          image_quality: {
            status: objectiveQualityNotes.length ? 'needs_retake' : 'locally_checked',
            concerns: objectiveQualityNotes,
            explanation: objectiveQualityNotes.length
              ? `Local image checks flagged: ${objectiveQualityNotes.join(', ')}.`
              : 'Local decoding, resolution, brightness, and blur checks completed; these do not measure medical prediction confidence.',
          },
          visible_observations: report.image_analyzed ? report.visible_observations : [],
          reported_symptoms: reportedSymptoms,
          reported_risk_factors: riskFactors,
          explanation:
            inferenceStatus === 'completed'
              ? 'Preliminary model observations are shown separately from patient-reported symptoms. A qualified clinician must review them.'
              : 'The image analysis was inconclusive. Do not use this result to reassure or delay clinical assessment.',
          recommended_next_steps: [
            'Arrange a qualified oral health examination, especially for persistent or concerning changes.',
          ],
          medical_limitations:
            'Gemini is a general-purpose vision model and is not clinically validated for oral disease screening. It cannot diagnose, confirm, rule out disease, or determine cancer stage.',
        },
      };
    }
  } else {
    inferenceStatus = 'not_performed';
    result = {
      risk_category: null,
      confidence: null,
      model_provider: 'questionnaire_demo',
      model_version: 'questionnaire-demo-v1',
      is_demo: true,
      inference_status: 'not_performed',
      disclaimer: 'DEMO AI OUTPUT – NOT FOR CLINICAL USE.',
      result_data: {
        source: 'questionnaire_demo',
        analysis_status: 'demonstration_only',
        inference_status: 'not_performed',
        image_analyzed: false,
        visible_observations: [],
        image_quality: {
          explanation: images.length ? 'Uploaded images are excluded from questionnaire demo.' : 'No image was uploaded.',
        },
        reported_symptoms: reportedSymptoms,
        reported_risk_factors: riskFactors,
        explanation: 'Demonstration only. This result summarizes reported questionnaire information.',
        recommended_next_steps: ['A qualified clinician should review persistent or concerning symptoms.'],
        medical_limitations: 'This tool does not diagnose and does not replace professional medical evaluation.',
      },
    };
  }
  const now = new Date();
  const resultData = {
    ...result.result_data,
    ...(result.safety_sentence ? { safety_sentence: result.safety_sentence } : {}),
  };
  const aiResult = {
    id: randomUUID(),
    screening_id: screeningId,
    risk_category: result.risk_category ?? null,
    confidence: result.confidence ?? null,
    model_provider: result.model_provider || modelProvider,
    model_version: result.model_version || null,
    inference_status: inferenceStatus,
    analysis_timestamp: now,
    is_demo: result.is_demo,
    disclaimer: result.disclaimer,
    result_data: resultData,
    created_at: now,
    updated_at: now,
  };
  await db.collection('ai_screening_results').insertOne(aiResult);
  await db
    .collection('oral_screenings')
    .updateOne({ id: screeningId }, { $set: { status: 'ai_completed', updated_at: now } });
  await audit(
    db,
    req,
    screeningId,
    result.is_demo ? 'screening.demo_ai_analysis' : 'screening.vision_ai_analysis',
    {
      model_provider: aiResult.model_provider,
      model_version: aiResult.model_version,
      inference_status: aiResult.inference_status,
      is_demo: result.is_demo,
      image_count: images.length,
    },
  );
  return aiResult;
}

async function submitClinicalReview(screeningId, input, user, req) {
  const db = await getDb();
  const screening = await assertScreeningAccess(db, screeningId, user);
  if (!['doctor', 'specialist'].includes(user.role)) {
    throw httpError(403, 'FORBIDDEN', 'Only doctors or specialists may submit a review');
  }
  const doctorProfile =
    user.role === 'doctor' ? await db.collection('doctors').findOne({ user_id: user.sub }) : null;
  const doctorRequest = await db.collection('screening_doctor_requests').findOne({
    screening_id: screeningId,
  });
  if (doctorRequest && (user.role !== 'doctor' || doctorRequest.doctor_id !== doctorProfile?.id)) {
    throw httpError(
      403,
      'FORBIDDEN',
      'Only the doctor selected by the patient may review this request',
    );
  }
  const status = input.recommend_referral
    ? 'referred'
    : input.review_status === 'completed'
      ? 'reviewed'
      : 'in_review';
  const now = new Date();
  const aiResult = await db
    .collection('ai_screening_results')
    .findOne({ screening_id: screeningId });
  const observationCount = aiResult?.result_data?.visible_observations?.length || 0;
  if (input.ai_observation_decisions.some((item) => item.observation_index >= observationCount)) {
    throw httpError(
      422,
      'INVALID_AI_OBSERVATION_REFERENCE',
      'Review references an unavailable AI observation',
    );
  }
  const review = {
    id: randomUUID(),
    screening_id: screeningId,
    reviewer_id: user.sub,
    reviewer_role: user.role,
    review_status: input.review_status,
    notes: input.provisional_notes || input.observations,
    observations: input.observations,
    provisional_notes: input.provisional_notes,
    follow_up_recommendation: input.follow_up_recommendation || '',
    follow_up_date: input.follow_up_date || null,
    recommend_referral: input.recommend_referral,
    recommended_investigations: input.recommended_investigations,
    ai_observation_decisions: input.ai_observation_decisions.map((item) => ({
      ...item,
      reviewer_id: user.sub,
      reviewed_at: now,
      source: 'clinician_review',
    })),
    reviewed_at: now,
    created_at: now,
    updated_at: now,
  };
  await db.collection('clinical_reviews').insertOne(review);
  await db
    .collection('oral_screenings')
    .updateOne({ id: screeningId }, { $set: { status, updated_at: now } });
  if (doctorRequest) {
    await db
      .collection('screening_doctor_requests')
      .updateOne(
        { id: doctorRequest.id, status: { $in: ['submitted', 'under_review'] } },
        { $set: { status: 'responded', responded_at: now, updated_at: now } },
      );
    const patient = await db.collection('patients').findOne({ id: screening.patient_id });
    await notificationService.create(
      db,
      patient?.user_id,
      'consultation',
      { screening_id: screeningId },
      {
        type: 'consultation',
        title: 'Doctor review completed',
        body: 'Your doctor has updated your screening report.',
        allowedChannels: ['in_app'],
      },
    );
  }
  let referral = null;
  if (input.recommend_referral) {
    referral = {
      id: randomUUID(),
      patient_id: screening.patient_id,
      screening_id: screeningId,
      referred_by: user.sub,
      referred_to_specialist_id: null,
      hospital_id: null,
      status: 'pending',
      reason: `Referral recommended during clinical review: ${input.provisional_notes || input.observations}`,
      urgency: 'soon',
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
      details: { status: 'pending', source: 'screening_review_recommendation' },
      created_at: now,
      updated_at: now,
    });
    const doctors = await db
      .collection('doctors')
      .find({
        $or: [{ phc_id: screening.phc_id }, { user_id: screening.screened_by }],
      })
      .toArray();
    const activeUsers = await db
      .collection('users')
      .find({
        id: { $in: doctors.map((doctor) => doctor.user_id) },
        is_active: true,
        deleted_at: null,
      })
      .toArray();
    for (const doctor of activeUsers) {
      await insertNotification(db, doctor.id, {
        screening_id: screeningId,
        referral_id: referral.id,
      });
    }
  }
  await audit(db, req, screeningId, 'screening.clinical_reviewed', {
    review_id: review.id,
    reviewer_role: user.role,
    review_status: input.review_status,
    recommend_referral: input.recommend_referral,
    referral_id: referral?.id || null,
  });
  return { review, referral, screening_status: status };
}

async function patientHistoryForScreening(screeningId, user) {
  const db = await getDb();
  const screening = await assertScreeningAccess(db, screeningId, user);
  return db.collection('medical_histories').findOne({ patient_id: screening.patient_id });
}

module.exports = {
  createScreening,
  listScreenings,
  screeningDetail,
  uploadImages,
  runAiAnalysis,
  submitClinicalReview,
  availableDoctors,
  createDoctorRequest,
  listDoctorRequests,
  updateDoctorRequestStatus,
  patientHistoryForScreening,
  assertScreeningAccess,
  assertDataCollectionConsent,
  pagination,
};
