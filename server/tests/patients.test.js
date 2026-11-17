process.env.JWT_ACCESS_SECRET = 'patient-test-access-secret-at-least-32-characters';

const mockSessionRoles = new Map();
jest.mock('../src/middleware/authenticate', () => (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ success: false, code: 'UNAUTHENTICATED', errors: [] });
  }
  req.user = require('jsonwebtoken').verify(token, process.env.JWT_ACCESS_SECRET);
  return next();
});

jest.mock('../src/medicines/service', () => ({}));
jest.mock('../src/admin/service', () => ({}));

jest.mock('../src/patients/service', () => ({
  registerPatient: jest.fn(),
  listPatients: jest.fn(),
  getPatient: jest.fn(),
  updatePatient: jest.fn(),
  deletePatient: jest.fn(),
  history: jest.fn(),
  recordConsent: jest.fn(),
  assertPatientScope: jest.fn(),
  assertPhotoConsent: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const patientService = require('../src/patients/service');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/auth/permissions');

const patientId = 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const validRegistration = {
  full_name: 'Synthetic Patient',
  age: 30,
  gender: 'female',
  mobile: '9876543210',
  village_name: 'Demo Village 1',
  gram_panchayat: 'Demo Gram Panchayat',
  district: 'Demo District 1',
  mandal: 'Demo Mandal 1',
  phc_name: 'Demonstration PHC 1',
  address: 'Synthetic address',
  medical_history: {
    conditions: [],
    allergies: [],
    current_medications: [],
  },
  tobacco_use: false,
  gutkha_use: false,
  areca_nut_use: false,
  current_symptoms: [],
  consent: { given: true, language: 'en' },
  client_uuid: 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce',
};

function auth(role = 'admin') {
  const sessionId = {
    admin: 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
    super_admin: 'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2',
    doctor: 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
    health_worker: 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4',
    specialist: 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5',
    patient: 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',
  }[role];
  mockSessionRoles.set(sessionId, role);
  return {
    Authorization: `Bearer ${jwt.sign(
      { role, permissions: DEFAULT_ROLE_PERMISSIONS[role] || [], pv: 1, sid: sessionId },
      process.env.JWT_ACCESS_SECRET,
      { subject: '7c31cbd1-ef65-4e8d-a526-c90dfb51192d', expiresIn: '5m' },
    )}`,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  patientService.assertPatientScope.mockResolvedValue({
    id: patientId,
    mobile: '9876543210',
  });
  patientService.registerPatient.mockResolvedValue({
    patient: { id: patientId, patient_code: 'AD-2026-000001' },
    created: true,
  });
  patientService.listPatients.mockResolvedValue({
    items: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  patientService.getPatient.mockResolvedValue({
    id: patientId,
    patient_code: 'AD-2026-000001',
  });
  patientService.updatePatient.mockResolvedValue({ id: patientId, updated: true });
  patientService.deletePatient.mockResolvedValue(undefined);
  patientService.history.mockResolvedValue({
    items: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  patientService.recordConsent.mockResolvedValue({
    consent_type: 'photo',
    granted: false,
    version: 1,
    language: 'en',
  });
});

describe('patient endpoints', () => {
  it('serves exactly the seven patient routes', async () => {
    const responses = await Promise.all([
      request(app).post('/api/patients').set(auth('admin')).send(validRegistration),
      request(app).get('/api/patients?page=1&limit=20').set(auth('doctor')),
      request(app).get(`/api/patients/${patientId}`).set(auth('doctor')),
      request(app)
        .put(`/api/patients/${patientId}`)
        .set(auth('doctor'))
        .send({ address: 'Updated address' }),
      request(app)
        .delete(`/api/patients/${patientId}`)
        .set(auth('admin'))
        .send({ reason: 'Synthetic record cleanup' }),
      request(app).get(`/api/patients/${patientId}/history?page=1&limit=20`).set(auth('doctor')),
      request(app)
        .post(`/api/patients/${patientId}/consent`)
        .set(auth('doctor'))
        .send({ consent_type: 'photo', granted: false, version: 1, language: 'en' }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      201, 200, 200, 200, 204, 200, 200,
    ]);
    expect(patientService.registerPatient).toHaveBeenCalledWith(
      expect.objectContaining({ gram_panchayat: 'Demo Gram Panchayat' }),
      expect.objectContaining({ user: expect.objectContaining({ role: 'admin' }) }),
    );
    for (const response of responses.filter((item) => item.status !== 204)) {
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
    }
  });

  it('validates input and reports missing consent as 422', async () => {
    const invalidRegistration = await request(app)
      .post('/api/patients')
      .set(auth('admin'))
      .send({ ...validRegistration, age: 300 });
    const invalidFilter = await request(app).get('/api/patients?age_min=-1').set(auth('doctor'));
    patientService.registerPatient.mockRejectedValueOnce(
      Object.assign(new Error('Patient data collection consent is required'), {
        status: 422,
        code: 'CONSENT_REQUIRED',
      }),
    );
    const missingConsent = await request(app)
      .post('/api/patients')
      .set(auth('admin'))
      .send({ ...validRegistration, consent: { given: false, language: 'en' } });

    expect(invalidRegistration.status).toBe(400);
    expect(invalidFilter.status).toBe(400);
    expect(missingConsent.status).toBe(422);
    expect(missingConsent.body.code).toBe('CONSENT_REQUIRED');
  });

  it('accepts and records the separate Gemini image-processing consent type', async () => {
    const response = await request(app)
      .post(`/api/patients/${patientId}/consent`)
      .set(auth('doctor'))
      .send({
        consent_type: 'ai_processing',
        granted: true,
        version: 1,
        language: 'en',
      });

    expect(response.status).toBe(200);
    expect(patientService.recordConsent).toHaveBeenCalledWith(
      patientId,
      { consent_type: 'ai_processing', granted: true, version: 1, language: 'en' },
      expect.objectContaining({ role: 'doctor' }),
      expect.anything(),
    );
  });

  it('requires a valid mobile number for patient login and returns a one-time credential only when created', async () => {
    const invalidRegistration = await request(app)
      .post('/api/patients')
      .set(auth('admin'))
      .send({ ...validRegistration, mobile: undefined });
    patientService.registerPatient.mockResolvedValueOnce({
      patient: { id: patientId, patient_code: 'AD-2026-000001' },
      created: true,
      temporary_password: 'OneTimePass1',
    });
    const created = await request(app)
      .post('/api/patients')
      .set(auth('admin'))
      .send(validRegistration);

    expect(invalidRegistration.status).toBe(400);
    expect(created.status).toBe(201);
    expect(created.body.data.temporary_password).toBe('OneTimePass1');
  });

  it('requires authentication and denies disallowed roles', async () => {
    const anonymous = await request(app).get('/api/patients');
    const patientList = await request(app).get('/api/patients').set(auth('patient'));
    const specialistCreate = await request(app)
      .post('/api/patients')
      .set(auth('specialist'))
      .send(validRegistration);
    const doctorDelete = await request(app)
      .delete(`/api/patients/${patientId}`)
      .set(auth('doctor'))
      .send({ reason: 'Synthetic cleanup' });
    const adminConsent = await request(app)
      .post(`/api/patients/${patientId}/consent`)
      .set(auth('admin'))
      .send({ consent_type: 'photo', granted: false, version: 1, language: 'en' });

    expect(anonymous.status).toBe(401);
    expect(patientList.status).toBe(403);
    expect(specialistCreate.status).toBe(403);
    expect(doctorDelete.status).toBe(403);
    expect(adminConsent.status).toBe(403);
  });

  it('returns possible duplicates in the standard error envelope', async () => {
    patientService.registerPatient.mockRejectedValueOnce(
      Object.assign(new Error('Possible matching patient records found'), {
        status: 409,
        code: 'PATIENT_DUPLICATE',
        candidates: [{ id: patientId, patient_code: 'AD-2026-000001' }],
      }),
    );
    const response = await request(app)
      .post('/api/patients')
      .set(auth('doctor'))
      .send(validRegistration);

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('PATIENT_DUPLICATE');
    expect(response.body.errors[0].candidates[0].id).toBe(patientId);
  });

  it('enforces ownership and assigned-area access for patient detail routes', async () => {
    patientService.assertPatientScope.mockRejectedValueOnce(
      Object.assign(new Error('You may only access your own patient record'), {
        status: 403,
        code: 'FORBIDDEN',
      }),
    );
    const response = await request(app).get(`/api/patients/${patientId}`).set(auth('patient'));
    expect(response.status).toBe(403);
    expect(patientService.getPatient).not.toHaveBeenCalled();
  });
});
