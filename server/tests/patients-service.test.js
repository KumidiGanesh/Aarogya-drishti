const mockCollections = new Map();

function matches(document, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((condition) => matches(document, condition));
    if (key === '$and') return expected.every((condition) => matches(document, condition));
    const actual = document[key];
    if (expected instanceof RegExp) return expected.test(actual);
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === '$ne') return actual !== value;
        if (operator === '$in') return value.includes(actual);
        if (operator === '$regex') return new RegExp(value, expected.$options || '').test(actual);
        if (operator === '$options') return true;
        if (operator === '$gte') return actual >= value;
        if (operator === '$gt') return actual > value;
        if (operator === '$lte') return actual <= value;
        if (operator === '$lt') return actual < value;
        return actual === value;
      });
    }
    return actual === expected || (expected === null && actual === undefined);
  });
}

function fakeCollection(name) {
  if (!mockCollections.has(name)) mockCollections.set(name, []);
  const documents = mockCollections.get(name);
  const project = (document, projection) => {
    if (!projection) return structuredClone(document);
    const result = {};
    for (const [field, include] of Object.entries(projection)) {
      if (include && document[field] !== undefined) result[field] = structuredClone(document[field]);
    }
    return result;
  };
  const cursor = (filter, options = {}) => {
    let rows = documents.filter((item) => matches(item, filter)).map((item) => project(item, options.projection));
    const result = {
      sort(spec) {
        rows.sort((a, b) => {
          for (const [field, direction] of Object.entries(spec)) {
            const left = a[field] instanceof Date ? a[field].getTime() : a[field];
            const right = b[field] instanceof Date ? b[field].getTime() : b[field];
            if (left < right) return -direction;
            if (left > right) return direction;
          }
          return 0;
        });
        return result;
      },
      skip(value) {
        rows = rows.slice(value);
        return result;
      },
      limit(value) {
        rows = rows.slice(0, value);
        return result;
      },
      async next() {
        return rows[0] || null;
      },
      async toArray() {
        return rows;
      },
    };
    return result;
  };
  return {
    findOne: jest.fn(async (filter, options) => {
      const row = documents.find((item) => matches(item, filter));
      return row ? project(row, options?.projection) : null;
    }),
    find: jest.fn((filter, options) => cursor(filter, options)),
    countDocuments: jest.fn(async (filter) => documents.filter((item) => matches(item, filter)).length),
    insertOne: jest.fn(async (document) => {
      documents.push(structuredClone(document));
      return { insertedId: document.id };
    }),
    replaceOne: jest.fn(async (filter, replacement) => {
      const index = documents.findIndex((item) => matches(item, filter));
      if (index >= 0) documents[index] = structuredClone(replacement);
      return { matchedCount: index >= 0 ? 1 : 0 };
    }),
    updateOne: jest.fn(async (filter, update, options = {}) => {
      let document = documents.find((item) => matches(item, filter));
      if (!document && options.upsert) {
        document = Object.fromEntries(Object.entries(filter).filter(([, value]) => value === null || typeof value !== 'object'));
        Object.assign(document, structuredClone(update.$setOnInsert || {}), structuredClone(update.$set || {}));
        documents.push(document);
        return { matchedCount: 0, upsertedCount: 1 };
      }
      if (document) Object.assign(document, structuredClone(update.$set || {}));
      return { matchedCount: document ? 1 : 0, modifiedCount: document ? 1 : 0 };
    }),
    updateMany: jest.fn(async (filter, update) => {
      const matched = documents.filter((item) => matches(item, filter));
      for (const document of matched) Object.assign(document, structuredClone(update.$set || {}));
      return { matchedCount: matched.length, modifiedCount: matched.length };
    }),
    deleteOne: jest.fn(async (filter) => {
      const index = documents.findIndex((item) => matches(item, filter));
      if (index >= 0) documents.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    }),
  };
}

const mockDb = { collection: jest.fn((name) => fakeCollection(name)) };

jest.mock('../src/db/mongo', () => ({
  getDb: jest.fn(async () => mockDb),
}));

const { getDb } = require('../src/db/mongo');
const patientService = require('../src/patients/service');
const bcrypt = require('bcrypt');

const patientId = 'patient-1';
const req = {
  user: { sub: 'health-worker-1', role: 'health_worker' },
  ip: '127.0.0.1',
  get: jest.fn(() => 'Jest'),
};
const registration = {
  full_name: 'Synthetic Patient',
  age: 30,
  gender: 'female',
  mobile: '9876543210',
  village_name: 'Demo Village',
  gram_panchayat: 'Demo Gram Panchayat',
  district: 'Demo District',
  mandal: 'Demo Mandal',
  phc_name: 'Demo PHC',
  address: 'Synthetic address',
  medical_history: { conditions: [], allergies: [], current_medications: [] },
  tobacco_use: false,
  gutkha_use: false,
  areca_nut_use: false,
  current_symptoms: [],
  consent: { given: true, language: 'en' },
  client_uuid: 'client-uuid-1',
};

function seed(name, ...documents) {
  mockCollections.set(name, documents.map((item) => structuredClone(item)));
}

beforeEach(() => {
  mockCollections.clear();
  jest.clearAllMocks();
  seed('villages', { id: 'village-1', name: 'Demo Village', district: 'Demo District', is_active: true });
  seed('phcs', { id: 'phc-1', name: 'Demo PHC', district: 'Demo District', is_active: true });
});

describe('Mongo-backed patient service', () => {
  it('creates a patient login and consented health profile after mobile verification', async () => {
    const { createHash, randomBytes } = require('node:crypto');
    const token = randomBytes(32).toString('base64url');
    seed('roles', {
      name: 'patient',
      is_system: true,
      permissions_version: 1,
    });
    seed('otp_grants', {
      token_hash: createHash('sha256').update(token).digest('hex'),
      target: '9876543210',
      purpose: 'patient_registration',
      expires_at: new Date(Date.now() + 600_000),
      consumed_at: null,
    });

    const result = await patientService.registerPublicPatient({
      verification_token: token,
      full_name: 'Self Registered Patient',
      age: 36,
      gender: 'female',
      mobile: '9876543210',
      email: 'self-registered@example.test',
      password: 'StrongPass1',
      village_name: 'Demo Village',
      mandal: 'Demo Mandal',
      address: 'Synthetic address',
      district: 'Demo District',
      state: 'Andhra Pradesh',
      emergency_contact_number: '9876543211',
      medical_history: {
        conditions: ['Synthetic condition'],
        allergies: [],
        current_medications: [],
        tobacco_use: true,
        gutkha_use: true,
      },
      consent: true,
      preferred_language: 'en',
    }, req);

    expect(result.patient).toMatchObject({
      full_name: 'Self Registered Patient',
      mobile: '9876543210',
      mandal: 'Demo Mandal',
      state: 'Andhra Pradesh',
    });
    expect(mockCollections.get('users')[0]).toMatchObject({
      role: 'patient',
      is_active: true,
      email: 'self-registered@example.test',
    });
    expect(await bcrypt.compare('StrongPass1', mockCollections.get('users')[0].password_hash)).toBe(true);
    expect(mockCollections.get('medical_histories')[0].conditions).toEqual(['Synthetic condition']);
    expect(mockCollections.get('medical_histories')[0]).toMatchObject({
      tobacco_use: true,
      gutkha_use: true,
    });
    expect(mockCollections.get('patient_consents')[0]).toMatchObject({
      consent_type: 'data_collection',
      granted: true,
    });
    expect(mockCollections.get('emergency_contacts')[0].mobile).toBe('9876543211');
    expect(mockCollections.get('audit_logs')[0].action).toBe('patient.self_registration.completed');
  });

  it('prevents a second public account for a mobile already stored on a patient profile', async () => {
    seed('patients', {
      id: 'existing-patient-profile',
      patient_code: 'AD-2020-000001',
      full_name: 'Existing Patient',
      mobile: '+91 98765 43210',
      is_active: true,
      deleted_at: null,
    });

    await expect(patientService.registerPublicPatient({
      mobile: '9876543210',
      email: 'new-account@example.test',
      age: 30,
      consent: true,
    }, req)).rejects.toMatchObject({
      status: 409,
      code: 'MOBILE_ALREADY_REGISTERED',
    });
    expect(mockCollections.get('patients')).toHaveLength(1);
    expect(mockCollections.get('users')).toHaveLength(0);
  });

  it('replays a client UUID without creating another patient and writes a sync log', async () => {
    seed('patients', {
      id: patientId,
      patient_code: 'AD-2026-000010',
      full_name: 'Demo Patient',
      registered_by: req.user.sub,
      village_name: 'Demo Village',
      district: 'Demo District',
      client_uuid: registration.client_uuid,
      deleted_at: null,
    });

    const result = await patientService.registerPatient(registration, req);

    expect(result).toMatchObject({ created: false, patient: { id: patientId } });
    expect(fakeCollection('patients').insertOne).not.toHaveBeenCalled();
    expect(mockCollections.get('patient_sync_log')[0]).toMatchObject({
      patient_id: patientId,
      sync_status: 'applied',
      details: { idempotent_replay: true },
    });
  });

  it('rejects registration without consent before opening Mongo', async () => {
    getDb.mockClear();
    await expect(patientService.registerPatient({
      ...registration,
      consent: { given: false, language: 'en' },
    }, req)).rejects.toMatchObject({ status: 422, code: 'CONSENT_REQUIRED' });
    expect(getDb).not.toHaveBeenCalled();
  });

  it('detects likely duplicates by name, mobile, and village unless force is justified', async () => {
    seed('health_workers', { user_id: req.user.sub, phc_id: 'phc-1' });
    seed('patients', {
      id: 'patient-duplicate',
      patient_code: 'AD-2026-000020',
      full_name: 'Synthetic Patient',
      mobile: registration.mobile,
      village_name: registration.village_name,
      is_active: true,
      deleted_at: null,
    });
    await expect(patientService.registerPatient(registration, req)).rejects.toMatchObject({
      status: 409,
      code: 'PATIENT_DUPLICATE',
      candidates: [{ id: 'patient-duplicate' }],
    });
    expect(mockCollections.get('patients')).toHaveLength(1);
  });

  it('creates patient-related records, audit, sync, and an in-app notification', async () => {
    seed('health_workers', { user_id: req.user.sub, phc_id: 'phc-1' });
    seed('users', {
      id: 'patient-user-1',
      role: 'patient',
      mobile: registration.mobile,
      is_active: true,
      deleted_at: null,
    });

    const result = await patientService.registerPatient(registration, req);

    expect(result.created).toBe(true);
    expect(result.patient.patient_code).toMatch(/^AD-\d{4}-\d{6}$/);
    expect(mockCollections.get('patients')[0]).toMatchObject({
      village_id: 'village-1',
      phc_id: 'phc-1',
      user_id: 'patient-user-1',
    });
    expect(mockCollections.get('medical_histories')[0].patient_id).toBe(result.patient.id);
    expect(mockCollections.get('patient_consents')[0]).toMatchObject({
      consent_type: 'data_collection',
      granted: true,
    });
    expect(mockCollections.get('notifications')[0]).toMatchObject({
      user_id: 'patient-user-1',
      notification_type: 'registration',
      data: { patient_id: result.patient.id, language: 'en' },
    });
    expect(mockCollections.get('audit_logs')[0]).toMatchObject({
      action: 'patient.registered',
      entity: 'patient',
      entity_id: result.patient.id,
    });
  });

  it('creates a patient login and can safely reissue an unclaimed temporary password on sync replay', async () => {
    seed('health_workers', { user_id: req.user.sub, phc_id: 'phc-1' });
    seed('roles', {
      id: 'patient-role',
      name: 'patient',
      is_system: true,
      permissions_version: 3,
      permissions: ['patients:read:self'],
    });

    const first = await patientService.registerPatient(registration, req);
    const user = mockCollections.get('users')[0];
    expect(first.created).toBe(true);
    expect(first.temporary_password).toMatch(/[A-Z]/);
    expect(first.temporary_password).toMatch(/[a-z]/);
    expect(first.temporary_password).toMatch(/\d/);
    expect(user).toMatchObject({
      mobile: registration.mobile,
      role: 'patient',
      is_active: true,
      must_change_password: true,
      permissions_version: 3,
    });
    expect(await bcrypt.compare(first.temporary_password, user.password_hash)).toBe(true);

    const replay = await patientService.registerPatient(registration, req);
    expect(replay.created).toBe(false);
    expect(replay.temporary_password).toBeTruthy();
    expect(replay.temporary_password).not.toBe(first.temporary_password);
    expect(await bcrypt.compare(replay.temporary_password, mockCollections.get('users')[0].password_hash))
      .toBe(true);
    expect(mockCollections.get('users')).toHaveLength(1);
  });

  it('enforces area ownership, soft deletion, and photo consent using Mongo collections', async () => {
    seed('users', {
      id: 'patient-user',
      role: 'patient',
      mobile: '9876543210',
      is_active: true,
      deleted_at: null,
    });
    seed('refresh_tokens', {
      id: 'patient-session',
      user_id: 'patient-user',
      revoked_at: null,
    });
    seed('patients', {
      id: patientId,
      user_id: 'patient-user',
      phc_id: 'phc-other',
      village_id: 'village-other',
      is_active: true,
      deleted_at: null,
    });
    await expect(patientService.assertPatientScope(patientId, req.user)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    seed('health_workers', { user_id: req.user.sub, phc_id: 'phc-other' });
    await expect(patientService.assertPatientScope(patientId, req.user)).resolves.toMatchObject({ id: patientId });
    await patientService.deletePatient(patientId, 'Synthetic record cleanup', req);
    expect(mockCollections.get('patients')[0]).toMatchObject({ is_active: false });
    expect(typeof mockCollections.get('patients')[0].deleted_at.getTime).toBe('function');
    expect(mockCollections.get('users')[0]).toMatchObject({ is_active: false });
    expect(mockCollections.get('refresh_tokens')[0].revoked_at).toBeTruthy();
    expect(mockCollections.get('audit_logs')[0].action).toBe('patient.soft_deleted');

    await expect(patientService.assertPhotoConsent(patientId)).rejects.toMatchObject({
      status: 403,
      code: 'PHOTO_CONSENT_REQUIRED',
    });
    seed('patient_consents', { patient_id: patientId, consent_type: 'photo', granted: true });
    await expect(patientService.assertPhotoConsent(patientId)).resolves.toBeUndefined();
  });

  it('filters patient lists and preserves pagination metadata', async () => {
    seed('doctors', { id: 'doctor-profile-1', user_id: 'doctor-1', phc_id: 'phc-1' });
    seed('patients',
      {
        id: 'p1', patient_code: 'AD-2026-000001', full_name: 'Synthetic Patient', age: 30,
        gender: 'female', mobile: '9876543210', district: 'Demo District', mandal: 'Demo Mandal',
        village_name: 'Demo Village', phc_name: 'Demo PHC', phc_id: 'phc-1', is_active: true, deleted_at: null,
        created_at: new Date('2026-01-02'),
      },
      {
        id: 'p2', patient_code: 'AD-2026-000002', full_name: 'Other Patient', age: 50,
        gender: 'male', district: 'Other District', is_active: true, deleted_at: null,
        created_at: new Date('2026-01-01'),
      });
    const result = await patientService.listPatients({ search: 'Synthetic', age_min: '20', page: '1', limit: '1' }, {
      role: 'doctor', sub: 'doctor-1',
    });
    expect(result.items).toMatchObject([{ id: 'p1', full_name: 'Synthetic Patient' }]);
    expect(result.meta).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
  });

  it('limits doctors to patients assigned by PHC or an appointment', async () => {
    seed('doctors', { id: 'doctor-profile-1', user_id: 'doctor-1', phc_id: 'phc-1' });
    seed('patients', {
      id: patientId,
      phc_id: 'phc-other',
      user_id: 'patient-user',
      is_active: true,
      deleted_at: null,
    });
    const doctor = { role: 'doctor', sub: 'doctor-1' };
    await expect(patientService.assertPatientScope(patientId, doctor)).rejects.toMatchObject({
      status: 403,
      code: 'PATIENT_NOT_ASSIGNED',
    });
    seed('appointments', {
      id: 'appointment-1',
      doctor_id: 'doctor-profile-1',
      patient_id: patientId,
      deleted_at: null,
    });
    await expect(patientService.assertPatientScope(patientId, doctor)).resolves.toMatchObject({ id: patientId });
  });

  it('updates the linked login mobile and revokes patient sessions together', async () => {
    seed('patients', {
      id: patientId,
      user_id: 'linked-patient-user',
      mobile: '9876543210',
      is_active: true,
      deleted_at: null,
    });
    seed('users', {
      id: 'linked-patient-user',
      role: 'patient',
      mobile: '9876543210',
      is_active: true,
      deleted_at: null,
    });
    seed('refresh_tokens', {
      id: 'linked-session',
      user_id: 'linked-patient-user',
      revoked_at: null,
    });
    const adminReq = {
      ...req,
      user: { sub: 'admin-1', role: 'admin' },
    };

    await patientService.updatePatient(
      patientId,
      { mobile: '9876543211' },
      adminReq.user,
      adminReq,
    );

    expect(mockCollections.get('patients')[0].mobile).toBe('9876543211');
    expect(mockCollections.get('users')[0].mobile).toBe('9876543211');
    expect(mockCollections.get('refresh_tokens')[0].revoked_at).toBeTruthy();
  });
});
