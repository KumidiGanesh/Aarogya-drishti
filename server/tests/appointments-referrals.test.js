process.env.JWT_ACCESS_SECRET = 'appointments-test-access-secret-at-least-32-characters';

let mockCurrentRole;
jest.mock('../src/db/mongo', () => ({
  getDb: jest.fn(async () => ({
    collection: (name) => ({
      findOne: async (filter) =>
        name === 'users'
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
              },
    }),
  })),
}));

jest.mock('../src/appointments/service', () => ({
  createAppointment: jest.fn(),
  listAppointments: jest.fn(),
  updateAppointment: jest.fn(),
  deleteAppointment: jest.fn(),
}));
jest.mock('../src/referrals/service', () => ({
  referralAction: jest.fn(),
  listReferrals: jest.fn(),
  getReferralDocument: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const appointments = require('../src/appointments/service');
const referrals = require('../src/referrals/service');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/auth/permissions');

const ids = {
  appointment: 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  patient: 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  doctor: 'e4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  referral: 'f4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  specialist: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  hospital: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  user: '7c31cbd1-ef65-4e8d-a526-c90dfb51192d',
};

function auth(role = 'doctor') {
  const sessionId = {
    admin: 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
    doctor: 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
    health_worker: 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4',
    specialist: 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5',
    patient: 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',
  }[role];
  mockCurrentRole = role;
  return {
    Authorization: `Bearer ${jwt.sign(
      { role, permissions: DEFAULT_ROLE_PERMISSIONS[role] || [], pv: 1, sid: sessionId },
      process.env.JWT_ACCESS_SECRET,
      { subject: ids.user, expiresIn: '5m' },
    )}`,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  appointments.createAppointment.mockResolvedValue({ id: ids.appointment, status: 'booked' });
  appointments.listAppointments.mockResolvedValue({
    items: [],
    available_slots: ['09:00'],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  appointments.updateAppointment.mockResolvedValue({
    appointment: { id: ids.appointment, status: 'cancelled' },
  });
  appointments.deleteAppointment.mockResolvedValue({ id: ids.appointment, status: 'cancelled' });
  referrals.referralAction.mockResolvedValue({ referral: { id: ids.referral, status: 'pending' } });
  referrals.listReferrals.mockResolvedValue({
    items: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
});

describe('appointment and referral endpoints', () => {
  it('protects research dataset routes behind authentication and explicit permissions', async () => {
    await request(app).get('/api/research/datasets').expect(401);
    await request(app).get('/api/research/datasets').set(auth('doctor')).expect(403);
    await request(app).get('/api/research/consent').expect(401);
    await request(app).get('/api/research/consent').set(auth('doctor')).expect(403);
    await request(app)
      .post('/api/research/consent')
      .set(auth('doctor'))
      .send({ research_ai_training: true, language: 'en' })
      .expect(403);
    await request(app)
      .post('/api/research/consent')
      .set(auth('patient'))
      .send({ research_ai_training: false, language: 'en' })
      .expect(400);
  });

  it('creates an appointment and lists available slots', async () => {
    const body = {
      patient_id: ids.patient,
      doctor_id: ids.doctor,
      hospital_id: ids.hospital,
      appointment_date: '2026-11-02',
      time_slot: '09:00',
      mode: 'in_person',
      reason: 'Synthetic demonstration booking',
    };
    const created = await request(app).post('/api/appointments').set(auth('doctor')).send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.appointment.status).toBe('booked');
    expect(created.body.message).toBe('Appointment request submitted');
    const listed = await request(app)
      .get('/api/appointments?doctor_id=' + ids.doctor + '&date=2026-11-02')
      .set(auth('doctor'));
    expect(listed.status).toBe(200);
    expect(listed.body.data.available_slots).toEqual(['09:00']);
  });

  it('accepts PHC-specific availability queries', async () => {
    const response = await request(app)
      .get(
        `/api/appointments?doctor_id=${ids.doctor}&phc_id=${ids.hospital}&appointment_date=2026-11-02`,
      )
      .set(auth('doctor'));

    expect(response.status).toBe(200);
    expect(appointments.listAppointments).toHaveBeenCalledWith(
      expect.objectContaining({ doctor_id: ids.doctor, phc_id: ids.hospital }),
      expect.objectContaining({ role: 'doctor' }),
    );
  });

  it('updates and soft-deletes appointment records', async () => {
    const updated = await request(app)
      .put(`/api/appointments/${ids.appointment}`)
      .set(auth('doctor'))
      .send({ action: 'complete' });
    expect(updated.status).toBe(200);
    const removed = await request(app)
      .delete(`/api/appointments/${ids.appointment}`)
      .set(auth('admin'));
    expect(removed.status).toBe(200);
    expect(appointments.deleteAppointment).toHaveBeenCalled();
  });

  it('creates multipart referrals and returns the status timeline list', async () => {
    const created = await request(app)
      .post('/api/referrals')
      .set(auth('doctor'))
      .field('action', 'create')
      .field('patient_id', ids.patient)
      .field('specialist_id', ids.specialist)
      .field('referral_hospital_id', ids.hospital)
      .field('reason', 'Synthetic referral for demonstration')
      .field('urgency', 'soon')
      .attach('supporting_documents[]', Buffer.from('%PDF-1.4 synthetic'), {
        filename: 'synthetic.pdf',
        contentType: 'application/pdf',
      });
    expect(created.status).toBe(201);
    const listed = await request(app).get('/api/referrals?page=1&limit=20').set(auth('doctor'));
    expect(listed.status).toBe(200);
    expect(listed.body.meta.totalPages).toBe(0);
  });

  it('streams referral documents without a cacheable public URL', async () => {
    referrals.getReferralDocument.mockResolvedValue({
      buffer: Buffer.from('%PDF-synthetic'),
      mimeType: 'application/pdf',
      filename: 'synthetic.pdf',
    });
    const response = await request(app)
      .get(`/api/referrals?download=${ids.referral}`)
      .set(auth('doctor'));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-disposition']).toContain('attachment');
  });

  it('returns 400 for invalid input and 403 for disallowed roles', async () => {
    const invalidAppointment = await request(app)
      .post('/api/appointments')
      .set(auth('doctor'))
      .send({ patient_id: 'bad' });
    expect(invalidAppointment.status).toBe(400);

    const forbiddenAppointment = await request(app)
      .get('/api/appointments')
      .set(auth('specialist'));
    expect(forbiddenAppointment.status).toBe(403);

    const forbiddenReferral = await request(app)
      .post('/api/referrals')
      .set(auth('patient'))
      .send({ action: 'create' });
    expect(forbiddenReferral.status).toBe(403);

    const invalidReferral = await request(app)
      .post('/api/referrals')
      .set(auth('doctor'))
      .send({ action: 'update_status', referral_id: 'bad', status: 'pending' });
    expect(invalidReferral.status).toBe(400);
  });

  it('requires authentication for appointment and referral reads', async () => {
    expect((await request(app).get('/api/appointments')).status).toBe(401);
    expect((await request(app).get('/api/referrals')).status).toBe(401);
  });
});
