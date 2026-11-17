process.env.JWT_ACCESS_SECRET = 'screening-test-access-secret-at-least-32-characters';

let mockCurrentRole;
jest.mock('../src/db/mongo', () => ({
  getDb: jest.fn(async () => ({
    collection: (name) => ({
      findOne: async (filter) => (name === 'users'
        ? {
            id: filter.id,
            is_active: true,
            deleted_at: null,
            role: mockCurrentRole,
            permissions_version: 1,
          }
        : name === 'roles'
          ? { name: filter.name, is_system: true, permissions_version: 1 }
        : {
            id: filter.id,
            user_id: filter.user_id,
            revoked_at: null,
            expires_at: new Date(Date.now() + 60_000),
          }),
    }),
  })),
}));

jest.mock('../src/screenings/service', () => ({
  createScreening: jest.fn(),
  listScreenings: jest.fn(),
  screeningDetail: jest.fn(),
  uploadImages: jest.fn(),
  runAiAnalysis: jest.fn(),
  submitClinicalReview: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const screeningService = require('../src/screenings/service');

const screeningId = 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const patientId = 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const imageId = 'e4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const validCreate = {
  patient_id: patientId,
  symptoms: [{ code: 'mouth_ulcer', severity: 'moderate', duration_days: 5, entered_via: 'typed' }],
  notes: '',
  client_uuid: 'f4b33580-1c35-4ae3-bf49-1f35532fd3ce',
};

function auth(role = 'doctor') {
  const sessionId = {
    admin: 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
    super_admin: 'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2',
    doctor: 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
    health_worker: 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4',
    specialist: 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5',
    patient: 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',
  }[role];
  mockCurrentRole = role;
  return {
    Authorization: `Bearer ${jwt.sign(
      { role, permissions: ['screenings:read', 'screenings:manage'], pv: 1, sid: sessionId },
      process.env.JWT_ACCESS_SECRET,
      { subject: '7c31cbd1-ef65-4e8d-a526-c90dfb51192d', expiresIn: '5m' },
    )}`,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  screeningService.createScreening.mockResolvedValue({
    screening: { id: screeningId, status: 'draft' },
    created: true,
  });
  screeningService.listScreenings.mockResolvedValue({
    items: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  screeningService.screeningDetail.mockResolvedValue({
    screening: { id: screeningId, symptoms: [], images: [] },
  });
  screeningService.uploadImages.mockResolvedValue({ images: [{ id: imageId }] });
  screeningService.runAiAnalysis.mockResolvedValue({
    risk_category: 'low',
    is_demo: true,
    disclaimer: 'DEMO AI OUTPUT – NOT FOR CLINICAL USE.',
  });
  screeningService.submitClinicalReview.mockResolvedValue({
    review: { id: imageId, review_status: 'completed' },
  });
});

describe('screening endpoints', () => {
  it('creates a screening and returns the creation status', async () => {
    const response = await request(app)
      .post('/api/screenings')
      .set(auth('doctor'))
      .send(validCreate);
    expect(response.status).toBe(201);
    expect(response.body.data.screening.id).toBe(screeningId);
  });

  it('allows an authenticated patient to create a screening through the self-service permission', async () => {
    const response = await request(app)
      .post('/api/screenings')
      .set(auth('patient'))
      .send(validCreate);
    expect(response.status).toBe(201);
    expect(screeningService.createScreening).toHaveBeenCalledWith(
      expect.objectContaining({ patient_id: patientId }),
      expect.objectContaining({ user: expect.objectContaining({ role: 'patient' }) }),
    );
  });

  it('lists screenings with pagination metadata', async () => {
    const response = await request(app)
      .get('/api/screenings?page=1&limit=20')
      .set(auth('doctor'));
    expect(response.status).toBe(200);
    expect(response.body.meta.totalPages).toBe(0);
  });

  it('accepts a backward-compatible report search term for scoped screening lists', async () => {
    const response = await request(app)
      .get('/api/screenings?search=Lakshmi')
      .set(auth('doctor'));
    expect(response.status).toBe(200);
    expect(screeningService.listScreenings).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Lakshmi' }),
      expect.objectContaining({ role: 'doctor' }),
    );
  });

  it('returns authorized screening detail', async () => {
    const response = await request(app)
      .get(`/api/screenings/${screeningId}`)
      .set(auth('doctor'));
    expect(response.status).toBe(200);
    expect(response.body.data.screening.id).toBe(screeningId);
  });

  it('uploads images only through the authenticated multipart route', async () => {
    const response = await request(app)
      .post(`/api/screenings/${screeningId}/upload-image`)
      .set(auth('doctor'))
      .field('site', 'front')
      .attach('images', Buffer.from('synthetic image content'), {
        filename: 'synthetic.jpg',
        contentType: 'image/jpeg',
      });
    expect(response.status).toBe(201);
    expect(response.body.data.images).toHaveLength(1);
  });

  it('allows a patient to upload images through the self-service permission', async () => {
    const response = await request(app)
      .post(`/api/screenings/${screeningId}/upload-image`)
      .set(auth('patient'))
      .field('site', 'front')
      .attach('images', Buffer.from('synthetic image content'), {
        filename: 'synthetic.jpg',
        contentType: 'image/jpeg',
      });
    expect(response.status).toBe(201);
    expect(screeningService.uploadImages).toHaveBeenCalled();
  });

  it('runs the demonstration analysis endpoint', async () => {
    const response = await request(app)
      .post(`/api/screenings/${screeningId}/ai-analysis`)
      .set(auth('doctor'));
    expect(response.status).toBe(200);
    expect(response.body.data.result.is_demo).toBe(true);
  });

  it('allows a patient to request analysis for their own screening', async () => {
    const response = await request(app)
      .post(`/api/screenings/${screeningId}/ai-analysis`)
      .set(auth('patient'));
    expect(response.status).toBe(200);
    expect(screeningService.runAiAnalysis).toHaveBeenCalled();
  });

  it('submits a clinical review endpoint', async () => {
    const response = await request(app)
      .post(`/api/screenings/${screeningId}/clinical-review`)
      .set(auth('doctor'))
      .send({
        observations: 'Synthetic review notes',
        provisional_notes: '',
        recommend_referral: false,
        recommended_investigations: [],
        review_status: 'completed',
      });
    expect(response.status).toBe(201);
    expect(response.body.data.review.review_status).toBe('completed');
  });

  it('streams an image privately without cacheable or permanent URLs', async () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    screeningService.screeningDetail.mockResolvedValue({
      stream: { buffer, mimeType: 'image/jpeg', imageId },
    });
    const response = await request(app)
      .get(`/api/screenings/${screeningId}?image_id=${imageId}`)
      .set(auth('doctor'));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-disposition']).toContain('inline');
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.body).toEqual(buffer);
  });

  it.each([
    [
      'create',
      () =>
        request(app)
          .post('/api/screenings')
          .set(auth('doctor'))
          .send({ ...validCreate, client_uuid: 'not-a-uuid' }),
    ],
    [
      'list',
      () => request(app).get('/api/screenings?risk_category=unknown').set(auth('doctor')),
    ],
    [
      'detail',
      () => request(app).get('/api/screenings/not-a-uuid').set(auth('doctor')),
    ],
    [
      'upload',
      () =>
        request(app)
          .post('/api/screenings/not-a-uuid/upload-image')
          .set(auth('doctor')),
    ],
    [
      'analysis',
      () => request(app).post('/api/screenings/not-a-uuid/ai-analysis').set(auth('doctor')),
    ],
    [
      'clinical review',
      () =>
        request(app)
          .post(`/api/screenings/${screeningId}/clinical-review`)
          .set(auth('doctor'))
          .send({ review_status: 'completed' }),
    ],
  ])('validates %s input', async (_name, execute) => {
    const response = await execute();
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['create', () => request(app).post('/api/screenings').send(validCreate)],
    ['list', () => request(app).get('/api/screenings')],
    ['detail', () => request(app).get(`/api/screenings/${screeningId}`)],
    ['upload', () => request(app).post(`/api/screenings/${screeningId}/upload-image`)],
    ['analysis', () => request(app).post(`/api/screenings/${screeningId}/ai-analysis`)],
    [
      'clinical review',
      () => request(app).post(`/api/screenings/${screeningId}/clinical-review`),
    ],
  ])('requires authentication for %s', async (_name, execute) => {
    const response = await execute();
    expect(response.status).toBe(401);
  });

  it.each([
    [
      'create',
      () =>
        request(app)
          .post('/api/screenings')
          .set(auth('admin'))
          .send(validCreate),
    ],
    [
      'list',
      () => {
        screeningService.listScreenings.mockRejectedValue(
          Object.assign(new Error('Outside assigned screening scope'), {
            status: 403,
            code: 'FORBIDDEN',
          }),
        );
        return request(app).get('/api/screenings').set(auth('patient'));
      },
    ],
    [
      'detail',
      () => {
        screeningService.screeningDetail.mockRejectedValue(
          Object.assign(new Error('Not the screening owner'), { status: 403, code: 'FORBIDDEN' }),
        );
        return request(app).get(`/api/screenings/${screeningId}`).set(auth('patient'));
      },
    ],
    [
      'upload',
      () =>
        request(app)
          .post(`/api/screenings/${screeningId}/upload-image`)
          .set(auth('admin')),
    ],
    [
      'analysis',
      () => request(app).post(`/api/screenings/${screeningId}/ai-analysis`).set(auth('admin')),
    ],
    [
      'clinical review',
      () =>
        request(app)
          .post(`/api/screenings/${screeningId}/clinical-review`)
          .set(auth('health_worker'))
          .send({ observations: 'Review', review_status: 'completed' }),
    ],
  ])('forbids unauthorized roles or scope for %s', async (_name, execute) => {
    const response = await execute();
    expect(response.status).toBe(403);
  });

  it('returns 413 when an uploaded image exceeds eight megabytes', async () => {
    const response = await request(app)
      .post(`/api/screenings/${screeningId}/upload-image`)
      .set(auth('doctor'))
      .attach('images', Buffer.alloc(8 * 1024 * 1024 + 1), {
        filename: 'oversized.jpg',
        contentType: 'image/jpeg',
      });
    expect(response.status).toBe(413);
    expect(response.body.code).toBe('UPLOAD_TOO_LARGE');
  });
});
