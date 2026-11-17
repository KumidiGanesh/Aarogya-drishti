const bcrypt = require('bcrypt');
const { randomBytes, randomUUID } = require('node:crypto');
const { getDb } = require('../db/mongo');
const notificationService = require('../services/notificationService');
const otpService = require('../auth/otpService');
const { mobileLookupValues, normalizeIndianMobile } = require('../auth/mobile');
const aadhaarService = require('./aadhaarService');

const notificationCopy = {
  en: ['Registration confirmed', 'Your demonstration patient record was created.'],
  te: ['నమోదు నిర్ధారించబడింది', 'మీ డెమో రోగి రికార్డు సృష్టించబడింది.'],
  hi: ['पंजीकरण की पुष्टि', 'आपका डेमो रोगी रिकॉर्ड बनाया गया।'],
  or: ['ପଞ୍ଜୀକରଣ ନିଶ୍ଚିତ', 'ଆପଣଙ୍କ ଡେମୋ ରୋଗୀ ରେକର୍ଡ ତିଆରି ହୋଇଛି।'],
};

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function withoutMongoId(document) {
  if (!document) return document;
  const result = { ...document };
  delete result._id;
  return result;
}

function patientSummary(row) {
  return {
    id: row.id,
    patient_code: row.patient_code,
    full_name: row.full_name,
    mobile: row.mobile,
    age: row.age,
    date_of_birth: row.date_of_birth || null,
    gender: row.gender,
    village_name: row.village_name,
    gram_panchayat: row.gram_panchayat || '',
    preferred_language: row.preferred_language,
    district: row.district,
    state: row.state || null,
    mandal: row.mandal,
    phc_name: row.phc_name,
    created_at: row.created_at,
  };
}

async function writeAudit(db, req, { action, patientId, metadata = {} }) {
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: req.user.sub,
    action,
    entity: 'patient',
    entity_id: patientId,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata,
    created_at: new Date(),
  });
}

async function writePatientReadAudit(db, req, action, patientId, metadata = {}) {
  if (!req?.user?.sub) return;
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: req.user.sub,
    action,
    entity: 'patient',
    entity_id: patientId || null,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata: { actor_role: req.user.role, ...metadata },
    created_at: new Date(),
  });
}

async function writeSyncLog(db, patientId, clientUuid, syncStatus, details = {}) {
  await db.collection('patient_sync_log').insertOne({
    id: randomUUID(),
    patient_id: patientId,
    client_uuid: clientUuid,
    sync_status: syncStatus,
    details,
    created_at: new Date(),
  });
}

const locationCollections = { villages: 'villages', phcs: 'phcs' };

async function resolveLocation(db, { id, name, collection, column, district }) {
  const locations = db.collection(locationCollections[collection]);
  if (id) {
    const selected = await locations.findOne({ id, is_active: true });
    if (!selected) {
      throw httpError(422, 'INVALID_LOCATION', `The selected ${column} is unavailable`);
    }
    return { id: selected.id, name: selected.name };
  }
  const filter = { is_active: true, name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } };
  if (district) filter.district = { $regex: `^${escapeRegex(district)}$`, $options: 'i' };
  const selected = await locations.find(filter).sort({ id: 1 }).limit(1).next();
  return selected ? { id: selected.id, name: selected.name } : { id: null, name };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findPatientUser(db, input, excludePatientId) {
  const users = await db.collection('users');
  const matchingUsers = await users.find({
    mobile: { $in: mobileLookupValues(input.mobile) },
    deleted_at: null,
  }).toArray();
  if (matchingUsers.length > 1) {
    throw httpError(409, 'PATIENT_ACCOUNT_EXISTS', 'This mobile number matches multiple accounts');
  }
  let user = matchingUsers[0] || null;
  let temporaryPassword;
  if (user) {
    if (user.role !== 'patient' || !user.is_active) {
      throw httpError(
        409,
        'PATIENT_ACCOUNT_EXISTS',
        'This mobile number is already assigned to another or inactive account',
      );
    }
    const linkedFilter = { user_id: user.id, deleted_at: null };
    if (excludePatientId) linkedFilter.id = { $ne: excludePatientId };
    if (await db.collection('patients').findOne(linkedFilter)) {
      throw httpError(
        409,
        'PATIENT_ACCOUNT_ALREADY_LINKED',
        'This patient account is already linked to another patient record',
      );
    }
  } else {
    const role = await db.collection('roles').findOne({ name: 'patient', is_system: true });
    if (!role) {
      throw httpError(503, 'PATIENT_ACCOUNT_UNAVAILABLE', 'Patient accounts are not configured');
    }
    temporaryPassword = `${randomBytes(9).toString('base64url')}Aa1`;
    user = {
      id: randomUUID(),
      full_name: input.full_name,
      email: null,
      mobile: normalizeIndianMobile(input.mobile) || input.mobile,
      password_hash: await bcrypt.hash(temporaryPassword, 12),
      preferred_language: input.consent.language,
      role: 'patient',
      is_active: true,
      deleted_at: null,
      failed_login_count: 0,
      locked_until: null,
      must_change_password: true,
      permissions_version: role.permissions_version || 1,
      created_at: new Date(),
      updated_at: new Date(),
    };
    try {
      await users.insertOne(user);
    } catch (error) {
      if (error.code === 11000) {
        throw httpError(
          409,
          'PATIENT_ACCOUNT_EXISTS',
          'An account already uses this mobile number',
        );
      }
      throw error;
    }
  }
  return { user, temporaryPassword };
}

async function reissueTemporaryPassword(db, patient, req) {
  if (!patient.user_id) return undefined;
  const users = db.collection('users');
  const user = await users.findOne({
    id: patient.user_id,
    role: 'patient',
    is_active: true,
    deleted_at: null,
    must_change_password: true,
  });
  if (!user) return undefined;
  const temporaryPassword = `${randomBytes(9).toString('base64url')}Aa1`;
  await users.updateOne(
    { id: user.id },
    {
      $set: {
        password_hash: await bcrypt.hash(temporaryPassword, 12),
        failed_login_count: 0,
        locked_until: null,
        updated_at: new Date(),
      },
    },
  );
  await writeAudit(db, req, {
    action: 'patient.credentials.temporary_password_reissued',
    patientId: patient.id,
    metadata: { patient_code: patient.patient_code },
  });
  return temporaryPassword;
}

function trigrams(value) {
  const normalized = `  ${String(value || '').toLowerCase()} `;
  const result = new Set();
  for (let index = 0; index < normalized.length - 2; index += 1) {
    result.add(normalized.slice(index, index + 3));
  }
  return result;
}

function similarity(left, right) {
  const a = trigrams(left);
  const b = trigrams(right);
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared || 1);
}

async function createRegistrationNotification(db, userId, language, patientId) {
  if (!userId) return;
  const copy = notificationCopy[language] || notificationCopy.en;
  await notificationService.create(
    db,
    userId,
    'registration_confirmation',
    { patient_id: patientId, language },
    { type: 'registration', title: copy[0], body: copy[1] },
  );
}

async function nextPatientCode(db) {
  const year = new Date().getFullYear();
  const prefix = `AD-${year}-`;
  const latest = await db
    .collection('patients')
    .find({ patient_code: { $regex: `^${prefix}\\d+$` } }, { projection: { patient_code: 1 } })
    .sort({ patient_code: -1 })
    .limit(1)
    .next();
  const sequence = latest ? Number(latest.patient_code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(sequence).padStart(6, '0')}`;
}

async function registerPatient(input, req) {
  if (!input.consent.given) {
    throw httpError(422, 'CONSENT_REQUIRED', 'Patient data collection consent is required');
  }
  const db = await getDb();
  const patients = db.collection('patients');
  const existing = await patients.findOne({ client_uuid: input.client_uuid, deleted_at: null });
  if (existing) {
    if (existing.registered_by !== req.user.sub) {
      throw httpError(
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'This offline registration key is already associated with another record',
      );
    }
    await writeSyncLog(db, existing.id, input.client_uuid, 'applied', { idempotent_replay: true });
    await aadhaarService.attachStaged(db, existing, input, req);
    return {
      patient: patientSummary(existing),
      created: false,
      temporary_password: await reissueTemporaryPassword(db, existing, req),
    };
  }

  const village = await resolveLocation(db, {
    id: input.village_id,
    name: input.village_name,
    collection: 'villages',
    column: 'village',
    district: input.district,
  });
  const phc = await resolveLocation(db, {
    id: input.phc_id,
    name: input.phc_name,
    collection: 'phcs',
    column: 'PHC',
    district: input.district,
  });

  if (req.user.role === 'health_worker') {
    const assigned = await db.collection('health_workers').findOne({
      user_id: req.user.sub,
      $or: [
        ...(phc.id ? [{ phc_id: phc.id }] : []),
        ...(village.id ? [{ village_id: village.id }] : []),
      ],
    });
    if (!assigned) {
      throw httpError(
        403,
        'OUTSIDE_ASSIGNED_AREA',
        'Patient location is outside your assigned area',
      );
    }
  }

  if (input.mobile) {
    const possible = await patients
      .find({
        mobile: { $in: mobileLookupValues(input.mobile) },
        deleted_at: null,
        is_active: true,
      })
      .toArray();
    const matchingPatients = (
      await Promise.all(
        possible.map(async (patient) => {
          const location = patient.village_id
            ? await db.collection('villages').findOne({ id: patient.village_id })
            : null;
          const resolvedVillage = location?.name || patient.village_name || '';
          return String(resolvedVillage).toLowerCase() ===
            String(village.name || '').toLowerCase() &&
            similarity(patient.full_name, input.full_name) > 0.6
            ? { ...patient, resolved_village_name: resolvedVillage }
            : null;
        }),
      )
    )
      .filter(Boolean)
      .sort(
        (left, right) =>
          similarity(right.full_name, input.full_name) -
            similarity(left.full_name, input.full_name) ||
          new Date(right.created_at || 0) - new Date(left.created_at || 0),
      )
      .slice(0, 5);
    const candidates = matchingPatients.map((patient) => ({
      id: patient.id,
      patient_code: patient.patient_code,
      full_name: patient.full_name,
      age: patient.age,
      district: patient.district,
      village_name: patient.resolved_village_name,
    }));
    if (candidates.length && !input.force) {
      const conflict = httpError(
        409,
        'PATIENT_DUPLICATE',
        'Possible matching patient records found',
      );
      conflict.candidates = candidates;
      throw conflict;
    }
  }

  await aadhaarService.validateStagedUploads(db, input, req);

  const existingStub = input.mobile
    ? await patients.findOne(
        {
        mobile: { $in: mobileLookupValues(input.mobile) },
          village_id: null,
          village_name: null,
          deleted_at: null,
          is_active: true,
        },
        { sort: { created_at: 1 } },
      )
    : null;
  const { user: account, temporaryPassword } = await findPatientUser(db, input, existingStub?.id);
  const now = new Date();
  const dateOfBirth = input.date_of_birth || null;
  const record = {
    id: existingStub?.id || randomUUID(),
    patient_code: existingStub?.patient_code || (await nextPatientCode(db)),
    full_name: input.full_name,
    age: dateOfBirth ? ageFromDateOfBirth(dateOfBirth, now) : input.age ?? null,
    date_of_birth: dateOfBirth,
    gender: input.gender ?? null,
    mobile: input.mobile,
    village_id: village.id,
    district: input.district,
    state: input.state || 'Andhra Pradesh',
    mandal: input.mandal,
    village_name: village.name,
    gram_panchayat: input.gram_panchayat || '',
    phc_id: phc.id,
    phc_name: phc.name,
    address: input.address,
    preferred_language: input.consent.language,
    aadhaar_last4: input.aadhaar_last4 || null,
    aadhaar_verification_status: input.aadhaar_last4 ? 'details_confirmed_unverified' : 'not_provided',
    aadhaar_document_ids: [],
    registered_by: req.user.sub,
    client_uuid: input.client_uuid,
    user_id: account?.id || null,
    is_active: true,
    deleted_at: null,
    created_at: existingStub?.created_at || now,
    updated_at: now,
  };

  try {
    if (existingStub) await patients.replaceOne({ id: existingStub.id }, record);
    else await patients.insertOne(record);
  } catch (error) {
    if (error.code === 11000) {
      const replay = await patients.findOne({
        client_uuid: input.client_uuid,
        deleted_at: null,
      });
      if (replay) {
        if (replay.registered_by !== req.user.sub) {
          throw httpError(
            409,
            'IDEMPOTENCY_KEY_CONFLICT',
            'This offline registration key is already associated with another record',
          );
        }
        await aadhaarService.attachStaged(db, replay, input, req);
        await writeSyncLog(db, replay.id, input.client_uuid, 'applied', {
          idempotent_replay: true,
        });
        if (temporaryPassword) await db.collection('users').deleteOne({ id: account.id });
        return {
          patient: patientSummary(replay),
          created: false,
          temporary_password: await reissueTemporaryPassword(db, replay, req),
        };
      }
      if (error.keyPattern?.patient_code) {
        record.patient_code = await nextPatientCode(db);
        try {
          await patients.insertOne(record);
        } catch (retryError) {
          if (temporaryPassword) await db.collection('users').deleteOne({ id: account.id });
          throw retryError;
        }
      } else {
        if (temporaryPassword) await db.collection('users').deleteOne({ id: account.id });
        throw error;
      }
    } else {
      if (temporaryPassword) await db.collection('users').deleteOne({ id: account.id });
      throw error;
    }
  }

  const history = input.medical_history || {};
  await db.collection('medical_histories').updateOne(
    { patient_id: record.id },
    {
      $set: {
        conditions: history.conditions || [],
        allergies: history.allergies || [],
        current_medications: history.current_medications || [],
        tobacco_use: input.tobacco_use,
        tobacco_duration_months: input.tobacco_duration_months ?? null,
        tobacco_frequency_per_day: input.tobacco_frequency_per_day ?? null,
        gutkha_use: input.gutkha_use,
        gutkha_duration_months: input.gutkha_duration_months ?? null,
        gutkha_frequency_per_day: input.gutkha_frequency_per_day ?? null,
        areca_nut_use: input.areca_nut_use,
        areca_nut_duration_months: input.areca_nut_duration_months ?? null,
        areca_nut_frequency_per_day: input.areca_nut_frequency_per_day ?? null,
        recorded_by: req.user.sub,
        updated_at: now,
      },
      $setOnInsert: { id: randomUUID(), patient_id: record.id, created_at: now },
    },
    { upsert: true },
  );
  if (input.current_symptoms?.length) {
    await db.collection('symptoms').insertOne({
      id: randomUUID(),
      patient_id: record.id,
      recorded_by: req.user.sub,
      symptom_codes: input.current_symptoms,
      created_at: now,
    });
  }
  await db.collection('patient_consents').updateOne(
    { patient_id: record.id, consent_type: 'data_collection' },
    {
      $set: {
        granted: true,
        version: 1,
        language: input.consent.language,
        granted_at: now,
        revoked_at: null,
        recorded_by: req.user.sub,
        updated_at: now,
      },
      $setOnInsert: {
        id: randomUUID(),
        patient_id: record.id,
        consent_type: 'data_collection',
        created_at: now,
      },
    },
    { upsert: true },
  );
  await aadhaarService.attachStaged(db, record, input, req);
  await createRegistrationNotification(
    db,
    account?.id || req.user.sub,
    input.consent.language,
    record.id,
  );
  await writeSyncLog(db, record.id, input.client_uuid, 'applied');
  if (temporaryPassword) {
    await writeAudit(db, req, {
      action: 'patient.credentials.temporary_password_issued',
      patientId: record.id,
      metadata: { patient_code: record.patient_code },
    });
  }
  await writeAudit(db, req, {
    action: 'patient.registered',
    patientId: record.id,
    metadata: {
      patient_code: record.patient_code,
      force: input.force,
      justification: input.force ? input.justification : undefined,
    },
  });
  return {
    patient: patientSummary(record),
    created: true,
    temporary_password: temporaryPassword,
  };
}

function ageFromDateOfBirth(dateOfBirth, now = new Date()) {
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
  )
    age -= 1;
  return age;
}

async function registerPublicPatient(input, req) {
  if (!input.consent) {
    throw httpError(422, 'CONSENT_REQUIRED', 'Patient data collection consent is required');
  }
  const now = new Date();
  const age = input.age ?? (input.date_of_birth ? ageFromDateOfBirth(input.date_of_birth, now) : null);
  if (!Number.isInteger(age) || age < 1 || age > 120) {
    throw httpError(422, 'INVALID_AGE', 'Enter an age from 1 to 120');
  }

  const db = await getDb();
  const users = db.collection('users');
  const email = input.email.trim().toLowerCase();
  const mobileValues = mobileLookupValues(input.mobile);
  if (await users.findOne({ mobile: { $in: mobileValues } })) {
    throw httpError(409, 'MOBILE_ALREADY_REGISTERED', 'This mobile number is already registered');
  }
  if (await db.collection('patients').findOne({
    mobile: { $in: mobileValues },
    deleted_at: null,
  })) {
    throw httpError(409, 'MOBILE_ALREADY_REGISTERED', 'This mobile number is already registered');
  }
  if (await users.findOne({ email, deleted_at: null })) {
    throw httpError(409, 'EMAIL_ALREADY_REGISTERED', 'This email address is already registered');
  }
  const role = await db.collection('roles').findOne({ name: 'patient', is_system: true });
  if (!role)
    throw httpError(503, 'PATIENT_ACCOUNT_UNAVAILABLE', 'Patient accounts are not configured');
  const mobile = normalizeIndianMobile(input.mobile) || input.mobile;
  await otpService.consumeGrant(input.verification_token, 'patient_registration', mobile);

  const userId = randomUUID();
  const patientId = randomUUID();
  const patientCode = await nextPatientCode(db);
  const clientUuid = randomUUID();
  const account = {
    id: userId,
    full_name: input.full_name,
    email,
    mobile,
    password_hash: await bcrypt.hash(input.password, 12),
    preferred_language: input.preferred_language,
    role: 'patient',
    is_active: true,
    must_change_password: false,
    deleted_at: null,
    failed_login_count: 0,
    permissions_version: role.permissions_version || 1,
    created_at: now,
  };
  const patient = {
    id: patientId,
    patient_code: patientCode,
    full_name: input.full_name,
    age,
    date_of_birth: input.date_of_birth || null,
    gender: input.gender,
    mobile,
    village_id: null,
    village_name: input.village_name,
    gram_panchayat: '',
    district: input.district,
    state: input.state,
    mandal: input.mandal || '',
    phc_id: null,
    phc_name: null,
    address: input.address,
    preferred_language: input.preferred_language,
    registered_by: userId,
    client_uuid: clientUuid,
    user_id: userId,
    is_active: true,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };

  try {
    await users.insertOne(account);
    await db.collection('patients').insertOne(patient);
    await db.collection('medical_histories').insertOne({
      id: randomUUID(),
      patient_id: patientId,
      conditions: input.medical_history.conditions || [],
      allergies: input.medical_history.allergies || [],
      current_medications: input.medical_history.current_medications || [],
      tobacco_use: input.medical_history.tobacco_use ?? false,
      gutkha_use: input.medical_history.gutkha_use ?? false,
      recorded_by: userId,
      created_at: now,
      updated_at: now,
    });
    await db.collection('patient_consents').insertOne({
      id: randomUUID(),
      patient_id: patientId,
      consent_type: 'data_collection',
      granted: true,
      version: 1,
      language: input.preferred_language,
      granted_at: now,
      revoked_at: null,
      recorded_by: userId,
      created_at: now,
      updated_at: now,
    });
    await db.collection('emergency_contacts').insertOne({
      id: randomUUID(),
      patient_id: patientId,
      full_name: 'Emergency contact',
      mobile: input.emergency_contact_number,
      relationship: '',
      is_primary: true,
      created_at: now,
      updated_at: now,
    });
    await db.collection('audit_logs').insertOne({
      id: randomUUID(),
      user_id: userId,
      action: 'patient.self_registration.completed',
      entity: 'patient',
      entity_id: patientId,
      ip: req.ip || null,
      user_agent: req.get('user-agent') || '',
      metadata: { patient_code: patientCode, role: 'patient' },
      created_at: now,
    });
  } catch (error) {
    await Promise.all([
      users.deleteMany({ id: userId }),
      db.collection('patients').deleteMany({ id: patientId }),
      db.collection('medical_histories').deleteMany({ patient_id: patientId }),
      db.collection('patient_consents').deleteMany({ patient_id: patientId }),
      db.collection('emergency_contacts').deleteMany({ patient_id: patientId }),
    ]);
    if (error.code === 11000) {
      throw error.keyPattern?.email
        ? httpError(409, 'EMAIL_ALREADY_REGISTERED', 'This email address is already registered')
        : httpError(409, 'MOBILE_ALREADY_REGISTERED', 'This mobile number is already registered');
    }
    throw error;
  }
  return { user: account, patient: patientSummary(patient) };
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

function contains(value) {
  return { $regex: escapeRegex(value), $options: 'i' };
}

async function listPatients(query, user, req) {
  const paging = pagination(query);
  const db = await getDb();
  const filter = { deleted_at: null, is_active: true };
  const and = [];
  const locationIds = async (collection, field, value) =>
    (
      await db
        .collection(collection)
        .find({ [field]: contains(value), is_active: true }, { projection: { id: 1 } })
        .toArray()
    ).map((item) => item.id);
  const addText = async (field, value) => {
    const conditions = [{ [field]: contains(value) }];
    if (field === 'village_name') {
      const ids = await locationIds('villages', 'name', value);
      if (ids.length) conditions.push({ village_id: { $in: ids } });
    }
    if (field === 'phc_name') {
      const ids = await locationIds('phcs', 'name', value);
      if (ids.length) conditions.push({ phc_id: { $in: ids } });
    }
    and.push({ $or: conditions });
  };
  if (query.search) {
    const search = contains(query.search);
    const [villageIds, phcIds] = await Promise.all([
      locationIds('villages', 'name', query.search),
      locationIds('phcs', 'name', query.search),
    ]);
    and.push({
      $or: [
        { full_name: search },
        { patient_code: search },
        { mobile: search },
        { village_name: search },
        { mandal: search },
        { district: search },
        ...(villageIds.length ? [{ village_id: { $in: villageIds } }] : []),
        { phc_name: search },
        ...(phcIds.length ? [{ phc_id: { $in: phcIds } }] : []),
      ],
    });
  }
  for (const [key, field] of [
    ['name', 'full_name'],
    ['patient_code', 'patient_code'],
    ['mobile', 'mobile'],
    ['village', 'village_name'],
    ['mandal', 'mandal'],
    ['district', 'district'],
    ['phc', 'phc_name'],
  ]) {
    if (query[key]) await addText(field, query[key]);
  }
  if (query.age_min) filter.age = { ...filter.age, $gte: Number(query.age_min) };
  if (query.age_max) filter.age = { ...filter.age, $lte: Number(query.age_max) };
  if (query.gender) filter.gender = query.gender;
  for (const flag of ['tobacco_use', 'gutkha_use', 'areca_nut_use']) {
    if (query[flag] !== undefined) {
      const histories = await db
        .collection('medical_histories')
        .find({ [flag]: query[flag] === 'true' }, { projection: { patient_id: 1 } })
        .toArray();
      and.push({ id: { $in: histories.map((history) => history.patient_id) } });
    }
  }
  if (query.from || query.to) {
    filter.created_at = {};
    if (query.from) filter.created_at.$gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to)
      filter.created_at.$lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86400000);
  }
  if (user.role === 'health_worker') {
    const assignments = await db.collection('health_workers').find({ user_id: user.sub }).toArray();
    and.push({
      $or: [
        { phc_id: { $in: assignments.map((item) => item.phc_id).filter(Boolean) } },
        { village_id: { $in: assignments.map((item) => item.village_id).filter(Boolean) } },
      ],
    });
  }
  if (user.role === 'doctor') {
    const patientIds = await assignedPatientIds(db, user.sub);
    and.push({ id: { $in: patientIds } });
  }
  if (user.role === 'specialist') {
    const specialists = await db.collection('specialists').find({ user_id: user.sub }).toArray();
    const referrals = await db
      .collection('referrals')
      .find(
        {
          referred_to_specialist_id: { $in: specialists.map((item) => item.id) },
        },
        { projection: { patient_id: 1 } },
      )
      .toArray();
    and.push({ id: { $in: referrals.map((item) => item.patient_id) } });
  }
  if (and.length) filter.$and = and;

  const [total, records] = await Promise.all([
    db.collection('patients').countDocuments(filter),
    db
      .collection('patients')
      .find(filter)
      .sort({ created_at: -1, id: 1 })
      .skip(paging.offset)
      .limit(paging.limit)
      .toArray(),
  ]);
  const items = await Promise.all(
    records.map(async (patient) => {
      const [village, phc] = await Promise.all([
        patient.village_id ? db.collection('villages').findOne({ id: patient.village_id }) : null,
        patient.phc_id ? db.collection('phcs').findOne({ id: patient.phc_id }) : null,
      ]);
      return {
        id: patient.id,
        patient_code: patient.patient_code,
        full_name: patient.full_name,
        age: patient.age,
        gender: patient.gender,
        mobile: patient.mobile,
        district: patient.district,
        mandal: patient.mandal,
        village_name: village?.name || patient.village_name,
        phc_name: phc?.name || patient.phc_name,
        created_at: patient.created_at,
      };
    }),
  );
  await writePatientReadAudit(db, req, 'patient.list.accessed', null, {
    result_count: items.length,
  });
  return {
    items,
    meta: {
      page: paging.page,
      limit: paging.limit,
      total,
      totalPages: Math.ceil(total / paging.limit),
    },
  };
}

async function assignedPatientIds(db, doctorUserId) {
  const doctor = await db.collection('doctors').findOne({ user_id: doctorUserId });
  if (!doctor) return [];
  const [appointments, patients, screeningRequests] = await Promise.all([
    db
      .collection('appointments')
      .find(
        {
          doctor_id: doctor.id,
          deleted_at: null,
        },
        { projection: { patient_id: 1 } },
      )
      .toArray(),
    doctor.phc_id
      ? db
          .collection('patients')
          .find(
            {
              phc_id: doctor.phc_id,
              is_active: true,
              deleted_at: null,
            },
            { projection: { id: 1 } },
          )
          .toArray()
      : Promise.resolve([]),
    db
      .collection('screening_doctor_requests')
      .find({ doctor_id: doctor.id }, { projection: { patient_id: 1 } })
      .toArray(),
  ]);
  return [
    ...new Set(
      [
        ...appointments.map((appointment) => appointment.patient_id),
        ...patients.map((patient) => patient.id),
        ...screeningRequests.map((request) => request.patient_id),
      ].filter(Boolean),
    ),
  ];
}

async function assertPatientScope(id, user) {
  const db = await getDb();
  const patient = await db.collection('patients').findOne(
    {
      id,
      deleted_at: null,
      is_active: true,
    },
    { projection: { id: 1, user_id: 1, phc_id: 1, village_id: 1 } },
  );
  if (!patient) throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
  if (user.role === 'patient' && patient.user_id !== user.sub) {
    throw httpError(403, 'FORBIDDEN', 'You may only access your own patient record');
  }
  if (user.role === 'doctor') {
    const doctor = await db.collection('doctors').findOne({ user_id: user.sub });
    const atAssignedFacility = Boolean(doctor?.phc_id && doctor.phc_id === patient.phc_id);
    const hasAppointment =
      doctor &&
      (await db.collection('appointments').findOne({
        doctor_id: doctor.id,
        patient_id: id,
        deleted_at: null,
      }));
    const hasScreeningRequest =
      doctor &&
      (await db.collection('screening_doctor_requests').findOne({
        doctor_id: doctor.id,
        patient_id: id,
      }));
    if (!atAssignedFacility && !hasAppointment && !hasScreeningRequest) {
      throw httpError(403, 'PATIENT_NOT_ASSIGNED', 'Patient is not assigned to this doctor');
    }
  }
  if (user.role === 'health_worker') {
    const assignment = await db.collection('health_workers').findOne({
      user_id: user.sub,
      $or: [
        ...(patient.phc_id ? [{ phc_id: patient.phc_id }] : []),
        ...(patient.village_id ? [{ village_id: patient.village_id }] : []),
      ],
    });
    if (!assignment) throw httpError(403, 'FORBIDDEN', 'Patient is outside your assigned area');
  }
  if (user.role === 'specialist') {
    const specialists = await db.collection('specialists').find({ user_id: user.sub }).toArray();
    const referral = await db.collection('referrals').findOne({
      patient_id: id,
      referred_to_specialist_id: { $in: specialists.map((item) => item.id) },
    });
    if (!referral) throw httpError(403, 'FORBIDDEN', 'Patient has not been referred to you');
  }
  return withoutMongoId(patient);
}

async function getPatient(id, user, req) {
  await assertPatientScope(id, user);
  const db = await getDb();
  const [
    rawPatient,
    medicalHistory,
    consents,
    symptoms,
    screeningDocs,
    appointments,
    referrals,
    reminders,
    contacts,
  ] = await Promise.all([
    db.collection('patients').findOne({ id, deleted_at: null, is_active: true }),
    db.collection('medical_histories').findOne({ patient_id: id }),
    db.collection('patient_consents').find({ patient_id: id }).sort({ consent_type: 1 }).toArray(),
    db
      .collection('symptoms')
      .find({ patient_id: id })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray(),
    db
      .collection('oral_screenings')
      .find({ patient_id: id })
      .sort({ screened_at: -1 })
      .limit(100)
      .toArray(),
    db
      .collection('appointments')
      .find({ patient_id: id, deleted_at: null })
      .sort({ scheduled_at: -1 })
      .limit(100)
      .toArray(),
    db
      .collection('referrals')
      .find({ patient_id: id })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray(),
    db
      .collection('medicine_reminders')
      .find({ patient_id: id })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray(),
    db
      .collection('emergency_contacts')
      .find({ patient_id: id })
      .sort({ is_primary: -1, created_at: 1 })
      .toArray(),
  ]);
  if (!rawPatient) throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
  await writePatientReadAudit(db, req, 'patient.record.accessed', id);
  const patient = withoutMongoId(rawPatient);
  const aadhaarConsent = consents.find((item) => item.consent_type === 'aadhaar_documents' && item.granted);
  const aadhaarDocuments = aadhaarConsent
    ? await db.collection('aadhaar_documents').find({ patient_id: id, redacted: true }).sort({ created_at: -1 }).toArray()
    : [];
  const [village, phc, registeredBy] = await Promise.all([
    patient.village_id ? db.collection('villages').findOne({ id: patient.village_id }) : null,
    patient.phc_id ? db.collection('phcs').findOne({ id: patient.phc_id }) : null,
    patient.registered_by ? db.collection('users').findOne({ id: patient.registered_by }) : null,
  ]);
  patient.aadhaar = {
    masked_number: patient.aadhaar_last4 ? `XXXX XXXX ${patient.aadhaar_last4}` : null,
    verification_status: patient.aadhaar_verification_status || 'not_provided',
    documents: aadhaarDocuments.map((document) => ({
      id: document.id,
      side: document.side,
      page: document.page,
      redacted: true,
      created_at: document.created_at,
    })),
  };
  delete patient.aadhaar_last4;
  delete patient.aadhaar_document_ids;
  patient.resolved_village_name = village?.name || patient.village_name;
  patient.resolved_phc_name = phc?.name || patient.phc_name;
  patient.village_name = patient.resolved_village_name;
  patient.phc_name = patient.resolved_phc_name;
  patient.registered_by_name = registeredBy?.full_name || null;

  const screenings = await Promise.all(
    screeningDocs.map(async (screening) => {
      const results = await db
        .collection('ai_screening_results')
        .find({ screening_id: screening.id })
        .toArray();
      return {
        id: screening.id,
        status: screening.status,
        screened_at: screening.screened_at,
        notes: screening.notes,
        ai_results: results.map((item) => ({
          risk_category: null,
          confidence: null,
          is_demo: item.is_demo,
          inference_status: item.inference_status || (item.is_demo ? 'not_performed' : 'unknown'),
          model_provider: item.model_provider || null,
          model_version: item.model_version || null,
          analysis_timestamp: item.analysis_timestamp || item.created_at,
          disclaimer: item.disclaimer,
        })),
      };
    }),
  );
  const [appointmentResults, referralResults, medicineResults] = await Promise.all([
    Promise.all(
      appointments.map(async (appointment) => {
        const facility =
          appointment.facility_type === 'phc'
            ? await db.collection('phcs').findOne({ id: appointment.facility_id })
            : await db.collection('hospitals').findOne({ id: appointment.facility_id });
        return {
          id: appointment.id,
          facility_type: appointment.facility_type,
          scheduled_at: appointment.scheduled_at,
          status: appointment.status,
          reason: appointment.reason,
          facility_name: facility?.name || null,
        };
      }),
    ),
    Promise.all(
      referrals.map(async (referral) => {
        const specialist = referral.referred_to_specialist_id
          ? await db.collection('specialists').findOne({ id: referral.referred_to_specialist_id })
          : null;
        const specialistUser = specialist?.user_id
          ? await db.collection('users').findOne({ id: specialist.user_id })
          : null;
        const hospital = referral.hospital_id
          ? await db.collection('hospitals').findOne({ id: referral.hospital_id })
          : null;
        return {
          id: referral.id,
          status: referral.status,
          reason: referral.reason,
          urgency: referral.urgency,
          feedback: referral.feedback,
          created_at: referral.created_at,
          specialist_name: specialistUser?.full_name || null,
          hospital_name: hospital?.name || null,
        };
      }),
    ),
    Promise.all(
      reminders.map(async (reminder) => {
        const medicine = await db.collection('medicines').findOne({ id: reminder.medicine_id });
        return {
          id: reminder.id,
          medicine_name: medicine?.name || null,
          dosage: reminder.dosage,
          instructions: reminder.instructions,
          starts_at: reminder.starts_at,
          ends_at: reminder.ends_at,
          is_active: reminder.is_active,
        };
      }),
    ),
  ]);
  return {
    ...patient,
    medical_history: medicalHistory ? withoutMongoId(medicalHistory) : null,
    consents: consents.map((consent) => ({
      consent_type: consent.consent_type,
      granted: consent.granted,
      version: consent.version,
      language: consent.language,
      granted_at: consent.granted_at,
      revoked_at: consent.revoked_at,
      created_at: consent.created_at,
      updated_at: consent.updated_at,
    })),
    symptoms: symptoms.map((item) => ({
      id: item.id,
      symptom_codes: item.symptom_codes,
      description: item.description,
      onset_date: item.onset_date,
      created_at: item.created_at,
    })),
    screenings,
    appointments: appointmentResults,
    referrals: referralResults,
    medicines: medicineResults,
    emergency_contacts: contacts.map((contact) => ({
      id: contact.id,
      full_name: contact.full_name,
      mobile: contact.mobile,
      relationship: contact.relationship,
      is_primary: contact.is_primary,
    })),
  };
}

const patientColumns = [
  'full_name',
  'age',
  'gender',
  'mobile',
  'district',
  'mandal',
  'gram_panchayat',
  'address',
];
const useHistoryFields = [
  'tobacco_use',
  'tobacco_duration_months',
  'tobacco_frequency_per_day',
  'gutkha_use',
  'gutkha_duration_months',
  'gutkha_frequency_per_day',
  'areca_nut_use',
  'areca_nut_duration_months',
  'areca_nut_frequency_per_day',
];
const historyFields = ['conditions', 'allergies', 'current_medications', ...useHistoryFields];

async function updatePatient(id, input, user, req) {
  await assertPatientScope(id, user);
  const db = await getDb();
  const patients = db.collection('patients');
  const patient = await patients.findOne({ id, deleted_at: null, is_active: true });
  if (!patient) throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
  const patientOnly = user.role === 'patient';
  const allowedPatientFields = new Set(['address', 'preferred_language', 'emergency_details']);
  if (patientOnly && Object.keys(input).some((key) => !allowedPatientFields.has(key))) {
    throw httpError(
      403,
      'PATIENT_FIELDS_RESTRICTED',
      'Patients may only update language, address, and emergency details',
    );
  }
  const oldValues = {};
  const newValues = {};
  const updates = {};
  for (const field of patientColumns) {
    if (input[field] !== undefined) {
      oldValues[field] = patient[field];
      updates[field] = input[field];
      newValues[field] = input[field];
    }
  }
  const accountMobileChanged =
    input.mobile !== undefined && input.mobile !== patient.mobile && Boolean(patient.user_id);
  if (accountMobileChanged) {
    const conflictingUser = await db.collection('users').findOne({
      mobile: input.mobile,
      deleted_at: null,
      id: { $ne: patient.user_id },
    });
    if (conflictingUser) {
      throw httpError(
        409,
        'PATIENT_ACCOUNT_EXISTS',
        'This mobile number is already assigned to another account',
      );
    }
    try {
      const result = await db
        .collection('users')
        .updateOne(
          { id: patient.user_id, deleted_at: null, is_active: true },
          { $set: { mobile: input.mobile, updated_at: new Date() } },
        );
      if (!result.matchedCount) {
        throw httpError(
          409,
          'PATIENT_ACCOUNT_UNAVAILABLE',
          'The linked patient login is unavailable',
        );
      }
    } catch (error) {
      if (error.code === 11000) {
        throw httpError(
          409,
          'PATIENT_ACCOUNT_EXISTS',
          'This mobile number is already assigned to another account',
        );
      }
      throw error;
    }
  }
  const village = patient.village_id
    ? await db.collection('villages').findOne({ id: patient.village_id })
    : null;
  const phc = patient.phc_id ? await db.collection('phcs').findOne({ id: patient.phc_id }) : null;
  if (input.village_id !== undefined || input.village_name !== undefined) {
    const location = input.village_id
      ? await resolveLocation(db, {
          id: input.village_id,
          collection: 'villages',
          column: 'village',
        })
      : input.village_name
        ? await resolveLocation(db, {
            name: input.village_name,
            collection: 'villages',
            column: 'village',
            district: input.district || patient.district,
          })
        : { id: null, name: null };
    oldValues.village_name = village?.name || patient.village_name;
    updates.village_id = location.id;
    updates.village_name = location.name;
    newValues.village_name = location.name;
  }
  if (input.phc_id !== undefined || input.phc_name !== undefined) {
    const location = input.phc_id
      ? await resolveLocation(db, { id: input.phc_id, collection: 'phcs', column: 'PHC' })
      : input.phc_name
        ? await resolveLocation(db, {
            name: input.phc_name,
            collection: 'phcs',
            column: 'PHC',
            district: input.district || patient.district,
          })
        : { id: null, name: null };
    oldValues.phc_name = phc?.name || patient.phc_name;
    updates.phc_id = location.id;
    updates.phc_name = location.name;
    newValues.phc_name = location.name;
  }
  if (input.preferred_language !== undefined) {
    updates.preferred_language = input.preferred_language;
    oldValues.preferred_language = patient.preferred_language;
    newValues.preferred_language = input.preferred_language;
  }
  if (Object.keys(updates).length) {
    updates.updated_at = new Date();
    try {
      await patients.updateOne({ id }, { $set: updates });
    } catch (error) {
      if (accountMobileChanged) {
        await db
          .collection('users')
          .updateOne(
            { id: patient.user_id },
            { $set: { mobile: patient.mobile, updated_at: new Date() } },
          );
      }
      throw error;
    }
  }
  if (accountMobileChanged) {
    await db
      .collection('refresh_tokens')
      .updateMany(
        { user_id: patient.user_id, revoked_at: null },
        { $set: { revoked_at: new Date() } },
      );
  }
  if (input.preferred_language) {
    await db
      .collection('users')
      .updateOne(
        { id: patient.user_id, deleted_at: null },
        { $set: { preferred_language: input.preferred_language, updated_at: new Date() } },
      );
  }
  if (input.medical_history || Object.keys(input).some((key) => useHistoryFields.includes(key))) {
    const historyCollection = db.collection('medical_histories');
    const before = (await historyCollection.findOne({ patient_id: id })) || {};
    const supplied = { ...(input.medical_history || {}) };
    for (const field of useHistoryFields)
      if (input[field] !== undefined) supplied[field] = input[field];
    const values = {};
    for (const field of historyFields) {
      values[field] = Object.prototype.hasOwnProperty.call(supplied, field)
        ? supplied[field]
        : (before[field] ??
          (field.endsWith('_use')
            ? false
            : ['conditions', 'allergies', 'current_medications'].includes(field)
              ? []
              : null));
    }
    oldValues.medical_history = Object.fromEntries(
      historyFields.map((field) => [field, before[field] ?? null]),
    );
    newValues.medical_history = values;
    await historyCollection.updateOne(
      { patient_id: id },
      {
        $set: { ...values, recorded_by: user.sub, updated_at: new Date() },
        $setOnInsert: { id: randomUUID(), patient_id: id, created_at: new Date() },
      },
      { upsert: true },
    );
  }
  if (input.current_symptoms?.length) {
    newValues.current_symptoms = input.current_symptoms;
    await db.collection('symptoms').insertOne({
      id: randomUUID(),
      patient_id: id,
      recorded_by: user.sub,
      symptom_codes: input.current_symptoms,
      created_at: new Date(),
    });
  }
  if (input.emergency_details !== undefined) {
    const contacts = db.collection('emergency_contacts');
    const previous = await contacts
      .find({ patient_id: id, is_primary: true })
      .sort({ created_at: 1 })
      .limit(1)
      .next();
    if (input.emergency_details) {
      if (previous) {
        oldValues.emergency_details = {
          full_name: previous.full_name,
          mobile: previous.mobile,
          relationship: previous.relationship,
        };
        await contacts.updateOne(
          { id: previous.id },
          {
            $set: {
              full_name: input.emergency_details.full_name,
              mobile: input.emergency_details.mobile,
              relationship: input.emergency_details.relationship,
              updated_at: new Date(),
            },
          },
        );
      } else {
        await contacts.insertOne({
          id: randomUUID(),
          patient_id: id,
          full_name: input.emergency_details.full_name,
          mobile: input.emergency_details.mobile,
          relationship: input.emergency_details.relationship,
          is_primary: true,
          created_at: new Date(),
        });
      }
      newValues.emergency_details = {
        full_name: input.emergency_details.full_name,
        mobile: input.emergency_details.mobile,
        relationship: input.emergency_details.relationship,
      };
    } else {
      if (previous) {
        oldValues.emergency_details = withoutMongoId(previous);
        await contacts.deleteOne({ id: previous.id });
      }
      newValues.emergency_details = null;
    }
  }
  await writeAudit(db, req, {
    action: 'patient.updated',
    patientId: id,
    metadata: { old_values: oldValues, new_values: newValues },
  });
  return { id, updated: true };
}

async function deletePatient(id, reason, req) {
  const db = await getDb();
  const now = new Date();
  const patient = await db
    .collection('patients')
    .findOne({ id, is_active: true, deleted_at: null });
  if (!patient) throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
  const result = await db
    .collection('patients')
    .updateOne(
      { id, is_active: true, deleted_at: null },
      { $set: { is_active: false, deleted_at: now, updated_at: now } },
    );
  if (!result.matchedCount) throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
  await aadhaarService.revokePatientDocuments(db, id);
  let accountDeactivated = false;
  if (patient.user_id) {
    const user = await db.collection('users').findOne({ id: patient.user_id, deleted_at: null });
    if (user) {
      await db
        .collection('users')
        .updateOne(
          { id: patient.user_id },
          { $set: { is_active: false, deleted_at: now, updated_at: now } },
        );
      await db
        .collection('refresh_tokens')
        .updateMany({ user_id: patient.user_id, revoked_at: null }, { $set: { revoked_at: now } });
      accountDeactivated = true;
    }
  }
  await writeAudit(db, req, {
    action: 'patient.soft_deleted',
    patientId: id,
    metadata: { reason, account_deactivated: accountDeactivated },
  });
}

async function recordConsent(id, input, user, req) {
  await assertPatientScope(id, user);
  const db = await getDb();
  const consents = db.collection('patient_consents');
  const previous = await consents.findOne({ patient_id: id, consent_type: input.consent_type });
  if (previous && input.version < previous.version) {
    throw httpError(409, 'CONSENT_VERSION_CONFLICT', 'Consent version must not move backwards');
  }
  const now = new Date();
  const grantedAt = input.granted ? now : previous?.granted_at || null;
  const revokedAt = input.granted ? null : now;
  await consents.updateOne(
    { patient_id: id, consent_type: input.consent_type },
    {
      $set: {
        granted: input.granted,
        version: input.version,
        language: input.language,
        granted_at: grantedAt,
        revoked_at: revokedAt,
        recorded_by: user.sub,
        updated_at: now,
      },
      $setOnInsert: {
        id: randomUUID(),
        patient_id: id,
        consent_type: input.consent_type,
        created_at: now,
      },
    },
    { upsert: true },
  );
  if (input.consent_type === 'aadhaar_documents' && !input.granted) {
    await aadhaarService.revokePatientDocuments(db, id);
  }
  const current = {
    consent_type: input.consent_type,
    granted: input.granted,
    version: input.version,
    language: input.language,
    granted_at: grantedAt,
    revoked_at: revokedAt,
  };
  await writeAudit(db, req, {
    action: input.granted ? 'patient.consent_granted' : 'patient.consent_revoked',
    patientId: id,
    metadata: {
      consent_type: input.consent_type,
      previous: previous ? withoutMongoId(previous) : null,
      current,
    },
  });
  return current;
}

async function assertPhotoConsent(patientId) {
  const db = await getDb();
  const consent = await db.collection('patient_consents').findOne({
    patient_id: patientId,
    consent_type: 'photo',
    granted: true,
  });
  if (!consent) {
    throw httpError(
      403,
      'PHOTO_CONSENT_REQUIRED',
      'Active photo consent is required before uploading an image',
    );
  }
}

function historyItem(occurredAt, type, title, details) {
  return { occurred_at: occurredAt, type, title, details };
}

async function history(id, query, user, req) {
  const paging = pagination(query);
  const db = await getDb();
  const patient = await db.collection('patients').findOne({ id });
  if (!patient || patient.deleted_at || !patient.is_active) {
    throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
  }
  if (user) await assertPatientScope(id, user);
  await writePatientReadAudit(db, req, 'patient.history.accessed', id);
  const timeline = [];
  if (patient) {
    timeline.push(
      historyItem(patient.created_at, 'registration', 'Patient record registered', {
        patient_code: patient.patient_code,
        registered_by: patient.registered_by,
      }),
    );
  }
  const [audits, screenings, referrals, appointments, consultations, reminders] = await Promise.all(
    [
      db.collection('audit_logs').find({ entity: 'patient', entity_id: id }).toArray(),
      db.collection('oral_screenings').find({ patient_id: id }).toArray(),
      db.collection('referrals').find({ patient_id: id }).toArray(),
      db.collection('appointments').find({ patient_id: id }).toArray(),
      db.collection('consultations').find({ patient_id: id }).toArray(),
      db.collection('medicine_reminders').find({ patient_id: id }).toArray(),
    ],
  );
  const screeningIds = screenings.map((item) => item.id);
  const referralIds = referrals.map((item) => item.id);
  const reminderIds = reminders.map((item) => item.id);
  const [aiResults, reviews, referralEvents, logs] = await Promise.all([
    screeningIds.length
      ? db
          .collection('ai_screening_results')
          .find({ screening_id: { $in: screeningIds } })
          .toArray()
      : [],
    screeningIds.length
      ? db
          .collection('clinical_reviews')
          .find({ screening_id: { $in: screeningIds } })
          .toArray()
      : [],
    referralIds.length
      ? db
          .collection('referral_events')
          .find({ referral_id: { $in: referralIds } })
          .toArray()
      : [],
    reminderIds.length
      ? db
          .collection('medication_logs')
          .find({ reminder_id: { $in: reminderIds } })
          .toArray()
      : [],
  ]);
  for (const audit of audits) {
    timeline.push(historyItem(audit.created_at, 'history_change', audit.action, audit.metadata));
  }
  for (const screening of screenings) {
    timeline.push(
      historyItem(screening.screened_at, 'screening', 'Screening recorded', {
        status: screening.status,
        notes: screening.notes,
      }),
    );
  }
  for (const result of aiResults) {
    timeline.push(
      historyItem(
        result.created_at,
        'ai_result',
        result.is_demo
          ? 'Demonstration screening result'
          : result.inference_status === 'failed'
            ? 'Image analysis failed'
            : 'Preliminary visual-observation result',
        {
          risk_category: null,
          is_demo: result.is_demo,
          inference_status:
            result.inference_status || (result.is_demo ? 'not_performed' : 'unknown'),
          disclaimer: result.disclaimer,
        },
      ),
    );
  }
  for (const review of reviews) {
    timeline.push(
      historyItem(review.reviewed_at, 'clinical_review', 'Clinical review recorded', {
        review_status: review.review_status,
        notes: review.notes,
      }),
    );
  }
  for (const referral of referrals) {
    timeline.push(
      historyItem(referral.created_at, 'referral', 'Referral updated', {
        status: referral.status,
        urgency: referral.urgency,
        reason: referral.reason,
        feedback: referral.feedback,
      }),
    );
  }
  for (const appointment of appointments) {
    timeline.push(
      historyItem(appointment.created_at, 'appointment', 'Appointment scheduled', {
        status: appointment.status,
        facility_type: appointment.facility_type,
        scheduled_at: appointment.scheduled_at,
      }),
    );
  }
  for (const consultation of consultations) {
    timeline.push(
      historyItem(consultation.created_at, 'consultation', 'Consultation recorded', {
        status: consultation.status,
      }),
    );
  }
  for (const event of referralEvents.filter((item) =>
    /follow|review/i.test(item.event_type || ''),
  )) {
    timeline.push(
      historyItem(event.created_at, 'follow_up', 'Referral follow-up', {
        event_type: event.event_type,
        details: event.details,
      }),
    );
  }
  for (const log of logs) {
    const reminder = reminders.find((item) => item.id === log.reminder_id);
    const medicine = reminder?.medicine_id
      ? await db.collection('medicines').findOne({ id: reminder.medicine_id })
      : null;
    timeline.push(
      historyItem(log.logged_at, 'medicine_adherence', 'Medicine adherence recorded', {
        status: log.status,
        scheduled_for: log.scheduled_for,
        medicine: medicine?.name,
      }),
    );
  }
  const filtered = timeline
    .filter((item) => !query.type || item.type === query.type)
    .sort(
      (left, right) =>
        new Date(right.occurred_at || 0) - new Date(left.occurred_at || 0) ||
        left.type.localeCompare(right.type),
    );
  const total = filtered.length;
  return {
    items: filtered.slice(paging.offset, paging.offset + paging.limit),
    meta: {
      page: paging.page,
      limit: paging.limit,
      total,
      totalPages: Math.ceil(total / paging.limit),
    },
  };
}

module.exports = {
  registerPatient,
  registerPublicPatient,
  assignedPatientIds,
  listPatients,
  getPatient,
  updatePatient,
  deletePatient,
  history,
  recordConsent,
  pagination,
  assertPatientScope,
  assertPhotoConsent,
};
