process.env.JWT_ACCESS_SECRET = 'phase-nine-test-access-secret-at-least-32-characters';

const mockUserRoles = new Map();
jest.mock('../src/db/mongo', () => ({
  getDb: jest.fn(async () => ({
    collection: (name) => ({
      findOne: jest.fn(async (query) => {
        if (name === 'users') return {
          id: query.id,
          is_active: true,
          deleted_at: null,
          role: mockUserRoles.get(query.id),
          permissions_version: 1,
        };
        if (name === 'refresh_tokens') return {
          id: query.id,
          user_id: query.user_id,
          revoked_at: null,
          expires_at: new Date(Date.now() + 60_000),
        };
        if (name === 'roles') return { name: query.name, is_system: true, permissions_version: 1 };
        return null;
      }),
    }),
  })),
}));
jest.mock('../src/medicines/service', () => ({
  createMedicine: jest.fn(),
  listMedicines: jest.fn(),
  createReminder: jest.fn(),
  listReminders: jest.fn(),
  createLog: jest.fn(),
  listLogs: jest.fn(),
}));
jest.mock('../src/emergency/service', () => ({
  sendSos: jest.fn(),
  getContacts: jest.fn(),
  addContact: jest.fn(),
  nearbyHospitals: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const medicines = require('../src/medicines/service');
const emergency = require('../src/emergency/service');
const { reminderSchedule } = jest.requireActual('../src/medicines/service');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/auth/permissions');

const ids = {
  patient: 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  medicine: 'e4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  reminder: 'f4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  contact: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
};
const userIds = {
  admin: 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
  doctor: 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
  health_worker: 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4',
  specialist: 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5',
  patient: 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',
};

function auth(role = 'doctor') {
  const sessionId = {
    admin: 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
    doctor: 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
    health_worker: 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4',
    specialist: 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5',
    patient: 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',
  }[role];
  const userId = userIds[role];
  mockUserRoles.set(userId, role);
  return {
    Authorization: `Bearer ${jwt.sign(
      { role, permissions: DEFAULT_ROLE_PERMISSIONS[role] || [], pv: 1, sid: sessionId },
      process.env.JWT_ACCESS_SECRET,
      { subject: userId, expiresIn: '5m' },
    )}`,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  medicines.createMedicine.mockResolvedValue({ data: { medicine: { id: ids.medicine } } });
  medicines.listMedicines.mockResolvedValue({ data: { items: [] }, meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  medicines.createReminder.mockResolvedValue({ data: { reminder: { id: ids.reminder } } });
  medicines.listReminders.mockResolvedValue({ data: { items: [] }, meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  medicines.createLog.mockResolvedValue({ data: { log: { id: ids.reminder, status: 'taken' } } });
  medicines.listLogs.mockResolvedValue({ data: { items: [], adherence: [] }, meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  emergency.sendSos.mockResolvedValue({
    data: { request: { id: ids.reminder, location_shared: false }, callable_options: { emergency: { href: 'tel:108' } } },
  });
  emergency.getContacts.mockResolvedValue({ data: { contacts: [], requests: [] } });
  emergency.addContact.mockResolvedValue({ data: { contact: { id: ids.contact } } });
  emergency.nearbyHospitals.mockResolvedValue({ data: { hospitals: [] }, meta: { page: 1, limit: 100, total: 0, totalPages: 1 } });
});

describe('Phase 9 medicine and emergency endpoints', () => {
  it('requires authentication on all ten business routes', async () => {
    const calls = [
      request(app).get('/api/medicines'),
      request(app).post('/api/medicines'),
      request(app).get('/api/medicine-reminders'),
      request(app).post('/api/medicine-reminders'),
      request(app).get('/api/medicine-logs'),
      request(app).post('/api/medicine-logs'),
      request(app).post('/api/emergency/sos'),
      request(app).get('/api/emergency/contacts'),
      request(app).post('/api/emergency/contacts'),
      request(app).get('/api/emergency/nearby-hospitals'),
    ];
    const responses = await Promise.all(calls);
    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(401));
  });

  it('requires authentication and restricts medicine-log actions to staff', async () => {
    expect((await request(app).get('/api/medicines')).status).toBe(401);
    expect((await request(app).post('/api/medicine-logs').set(auth('doctor')).send({})).status).toBe(400);
    expect((await request(app).post('/api/medicine-logs').set(auth('patient')).send({})).status).toBe(403);
  });

  it('validates medicine and reminder inputs before service calls', async () => {
    const invalidMedicine = await request(app).post('/api/medicines').set(auth()).send({
      patient_id: ids.patient, name: '', dosage: '1', form: 'tablet',
    });
    expect(invalidMedicine.status).toBe(400);
    expect(medicines.createMedicine).not.toHaveBeenCalled();

    const invalidReminder = await request(app).post('/api/medicine-reminders').set(auth()).send({
      medicine_id: ids.medicine,
      frequency: 'twice_daily',
      reminder_times: ['09:00'],
      start_date: '2026-10-31',
    });
    expect(invalidReminder.status).toBe(400);
    expect(medicines.createReminder).not.toHaveBeenCalled();
  });

  it('validates list, log, SOS, contact, and hospital query inputs', async () => {
    const invalidCalls = [
      request(app).get('/api/medicines?page=0').set(auth()),
      request(app).get('/api/medicine-reminders?status=paused').set(auth()),
      request(app).post('/api/medicine-logs').set(auth()).send({
        reminder_id: ids.reminder, scheduled_for: 'not-a-date', status: 'taken',
      }),
      request(app).get('/api/medicine-logs?status=unknown').set(auth()),
      request(app).post('/api/emergency/sos').set(auth('patient')).send({
        location_consent: true, latitude: 17.4,
      }),
      request(app).get('/api/emergency/contacts?page=0').set(auth('admin')),
      request(app).post('/api/emergency/contacts').set(auth('patient')).send({
        name: 'Demo Contact', relationship: 'Family', mobile: '12345',
      }),
      request(app).get('/api/emergency/nearby-hospitals?latitude=17.4').set(auth()),
    ];
    const responses = await Promise.all(invalidCalls);
    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400, 400, 400, 400]);
  });

  it('serves the six medicine endpoints with the expected response envelope', async () => {
    const created = await request(app).post('/api/medicines').set(auth()).send({
      patient_id: ids.patient, name: 'Demo medicine', dosage: '1 tablet', form: 'tablet',
    });
    const list = await request(app).get('/api/medicines?page=1&limit=10').set(auth());
    const reminder = await request(app).post('/api/medicine-reminders').set(auth()).send({
      medicine_id: ids.medicine, frequency: 'once_daily', reminder_times: ['09:00'], start_date: '2026-10-31',
    });
    const reminders = await request(app).get('/api/medicine-reminders').set(auth());
    const log = await request(app).post('/api/medicine-logs').set(auth()).send({
      reminder_id: ids.reminder, scheduled_for: '2026-10-31T03:30:00.000Z', status: 'taken',
    });
    const logs = await request(app).get('/api/medicine-logs?summary=true').set(auth());
    expect([created.status, list.status, reminder.status, reminders.status, log.status, logs.status])
      .toEqual([201, 200, 201, 200, 200, 200]);
    expect(list.body).toMatchObject({ success: true, data: { items: [] }, meta: { page: 1 } });
  });

  it('prevents patient-only emergency actions from being called with a staff session', async () => {
    const response = await request(app).post('/api/emergency/sos').set(auth('doctor')).send({
      location_consent: false, contact_ids: [],
    });
    expect(response.status).toBe(403);
    expect(emergency.sendSos).not.toHaveBeenCalled();
  });

  it('validates contacts and exposes only the four emergency route paths', async () => {
    const invalid = await request(app).post('/api/emergency/contacts').set(auth('patient')).send({
      name: 'Demo Contact', relationship: 'Family', mobile: '12345',
    });
    expect(invalid.status).toBe(400);
    const list = await request(app).get(`/api/emergency/contacts?patient_id=${ids.patient}`).set(auth('admin'));
    const nearby = await request(app).get('/api/emergency/nearby-hospitals?lat=17.4&lng=78.4').set(auth());
    expect([list.status, nearby.status]).toEqual([200, 200]);
    expect(emergency.getContacts).toHaveBeenCalled();
    expect(emergency.nearbyHospitals).toHaveBeenCalled();
  });

  it('forbids staff roles outside emergency route authorization', async () => {
    expect((await request(app).post('/api/medicines').set(auth('specialist')).send({})).status).toBe(403);
    expect((await request(app).post('/api/emergency/sos').set(auth('doctor')).send({})).status).toBe(403);
    expect((await request(app).get('/api/emergency/contacts').set(auth('doctor'))).status).toBe(403);
    expect((await request(app).post('/api/emergency/contacts').set(auth('doctor')).send({})).status).toBe(403);
    expect((await request(app).post('/api/medicine-reminders').set(auth('specialist')).send({})).status).toBe(403);
  });
});

describe('medicine schedule dates', () => {
  it('schedules doses in Asia/Kolkata time across the next seven calendar days', () => {
    const result = reminderSchedule(
      '2026-10-31',
      undefined,
      ['09:00', '21:00'],
      new Date('2026-10-31T00:00:00.000Z'),
    );
    expect(result.logTimes).toHaveLength(14);
    expect(result.logTimes[0]).toBe('2026-10-31T03:30:00.000Z');
    expect(result.generatedUntil).toBe('2026-11-06');
  });
});
