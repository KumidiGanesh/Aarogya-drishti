process.env.JWT_ACCESS_SECRET = 'phase-eleven-test-access-secret-at-least-32-characters';

jest.mock('../src/db/mongo', () => {
  const mongoMock = require('./helpers/mongoMock');
  return {
    ...mongoMock,
    getDb: jest.fn(async () => mongoMock.getDb()),
  };
});
jest.mock('../src/notifications/service', () => ({
  list: jest.fn(),
  markRead: jest.fn(),
  updatePreferences: jest.fn(),
}));
jest.mock('../src/consultations/service', () => ({
  create: jest.fn(),
  list: jest.fn(),
  getById: jest.fn(),
  getCallHistory: jest.fn(),
  callAction: jest.fn(),
}));
jest.mock('../src/reports/service', () => ({ analytics: jest.fn() }));
jest.mock('../src/settings/service', () => ({ get: jest.fn(), update: jest.fn() }));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const notifications = require('../src/notifications/service');
const consultations = require('../src/consultations/service');
const reports = require('../src/reports/service');
const settings = require('../src/settings/service');
const { getDb } = require('../src/db/mongo');
const mongoMock = require('./helpers/mongoMock');
const storedNotifications = jest.requireActual('../src/notifications/service');
const storedSettings = jest.requireActual('../src/settings/service');
const storedReports = jest.requireActual('../src/reports/service');
const notificationDelivery = jest.requireActual('../src/services/notificationService');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/auth/permissions');
const medicineReminderJob = jest.requireActual('../src/jobs/medicineReminderJob');
const notificationScheduleJob = jest.requireActual('../src/jobs/notificationScheduleJob');

const userId = '7c31cbd1-ef65-4e8d-a526-c90dfb51192d';
const roleUserIds = {
  patient: '7c31cbd1-ef65-4e8d-a526-c90dfb511921',
  doctor: userId,
  admin: '7c31cbd1-ef65-4e8d-a526-c90dfb511922',
  super_admin: '7c31cbd1-ef65-4e8d-a526-c90dfb511923',
  visitor: '7c31cbd1-ef65-4e8d-a526-c90dfb511924',
};
const validId = 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const pagination = { page: 1, limit: 20, total: 0, totalPages: 0 };

function mongoCursor(items = []) {
  const result = {
    sort: jest.fn(() => result),
    skip: jest.fn(() => result),
    limit: jest.fn(() => result),
    toArray: jest.fn(async () => items),
  };
  return result;
}

function auth(role = 'doctor') {
  const sessionId = {
    patient: 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',
    doctor: 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
    admin: 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
    super_admin: 'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2',
    visitor: 'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7',
  }[role];
  return {
    Authorization: `Bearer ${jwt.sign(
      { role, permissions: DEFAULT_ROLE_PERMISSIONS[role] || [], pv: 1, sid: sessionId },
      process.env.JWT_ACCESS_SECRET,
      { subject: roleUserIds[role], expiresIn: '5m' },
    )}`,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mongoMock.reset();
  getDb.mockImplementation(() => mongoMock.getDb());
  Object.entries(roleUserIds).forEach(([role, id]) => {
    const sessionId = {
      patient: 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',
      doctor: 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
      admin: 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
      super_admin: 'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2',
      visitor: 'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7',
    }[role];
    mongoMock.insert('users', {
      id,
      role,
      is_active: true,
      deleted_at: null,
      permissions_version: 1,
    });
    mongoMock.insert('roles', {
      name: role,
      is_system: true,
      permissions_version: 1,
      permissions: DEFAULT_ROLE_PERMISSIONS[role] || [],
    });
    mongoMock.insert('refresh_tokens', {
      id: sessionId,
      user_id: id,
      revoked_at: null,
      expires_at: new Date(Date.now() + 60000),
    });
  });
  notifications.list.mockResolvedValue({ items: [], unread_count: 0, meta: pagination });
  notifications.markRead.mockResolvedValue({ id: 'all', updated: 0 });
  notifications.updatePreferences.mockResolvedValue({ types: { emergency: true } });
  consultations.create.mockResolvedValue({ consultation_id: validId, status: 'scheduled', join: null });
  consultations.list.mockResolvedValue({ items: [], meta: pagination });
  consultations.getById.mockResolvedValue({ id: validId, notes: [] });
  consultations.getCallHistory.mockResolvedValue([]);
  consultations.callAction.mockResolvedValue({ id: validId, status: 'ringing' });
  reports.analytics.mockResolvedValue({ data: { total_registrations: 0 } });
  settings.get.mockResolvedValue({ language: 'en', font_size: 'medium' });
  settings.update.mockResolvedValue({ language: 'en', font_size: 'large' });
});

describe('Phase 11 notification, consultation, analytics and settings routes', () => {
  it('secures notification list, validates filters and returns unread count', async () => {
    await request(app).get('/api/notifications').expect(401);
    await request(app).get('/api/notifications?limit=invalid').set(auth()).expect(400);
    const response = await request(app).get('/api/notifications?type=medicine')
      .set(auth()).expect(200);
    expect(response.body.data.unread_count).toBe(0);
    expect(notifications.list).toHaveBeenCalled();
  });

  it('marks one or all notifications read only for authenticated allowed roles', async () => {
    await request(app).put(`/api/notifications/${validId}/read`).send({}).expect(401);
    await request(app).put('/api/notifications/not-a-uuid/read').set(auth()).expect(400);
    await request(app).put('/api/notifications/all/read').set(auth()).expect(200);
    expect(notifications.markRead).toHaveBeenCalledWith(userId, 'all', expect.any(Object));
    await request(app).put(`/api/notifications/${validId}/read`).set(auth('visitor')).expect(403);
  });

  it('validates and stores notification preferences for the authenticated user', async () => {
    await request(app).put('/api/notifications/preferences').send({}).expect(401);
    await request(app).put('/api/notifications/preferences').set(auth())
      .send({ channels: { unexpected: true } }).expect(400);
    await request(app).put('/api/notifications/preferences').set(auth())
      .send({ channels: { in_app: true }, quiet_hours: { enabled: false, start: '22:00', end: '07:00' } })
      .expect(200);
  });

  it('creates scheduled consultations only with valid action input and allowed role', async () => {
    await request(app).post('/api/consultations').send({}).expect(401);
    await request(app).post('/api/consultations').set(auth())
      .send({ action: 'schedule', appointment_id: 'invalid' }).expect(400);
    await request(app).post('/api/consultations').set(auth('visitor'))
      .send({ action: 'schedule', appointment_id: validId }).expect(403);
    await request(app).post('/api/consultations').set(auth('super_admin'))
      .send({ action: 'schedule', appointment_id: validId }).expect(200);
    await request(app).post('/api/consultations').set(auth('doctor'))
      .send({ action: 'schedule', appointment_id: validId }).expect(200);
    expect(consultations.create).toHaveBeenCalledWith(
      { action: 'schedule', appointment_id: validId },
      expect.objectContaining({ role: 'doctor' }),
      expect.any(Object),
    );
    expect(consultations.create).toHaveBeenCalledWith(
      { action: 'schedule', appointment_id: validId },
      expect.objectContaining({ role: 'super_admin' }),
      expect.any(Object),
    );
  });

  it('returns role-scoped consultation history and rejects invalid filters', async () => {
    await request(app).get('/api/consultations').expect(401);
    await request(app).get('/api/consultations?status=unknown').set(auth()).expect(400);
    await request(app).get('/api/consultations?availability=true').set(auth('doctor')).expect(200);
    expect(consultations.list).toHaveBeenCalled();
  });

  it('secures consultation detail and call history to authenticated, authorized roles', async () => {
    await request(app).get(`/api/consultations/${validId}`).expect(401);
    await request(app).get('/api/consultations/not-a-uuid').set(auth()).expect(400);
    await request(app).get(`/api/consultations/${validId}`).set(auth()).expect(200);
    expect(consultations.getById).toHaveBeenCalledWith(
      validId,
      expect.objectContaining({ role: 'doctor' }),
    );
    await request(app).get(`/api/consultations/${validId}/calls`).set(auth('visitor')).expect(403);
    await request(app).get(`/api/consultations/${validId}/calls`).set(auth('patient')).expect(200);
    expect(consultations.getCallHistory).toHaveBeenCalledWith(
      validId,
      expect.objectContaining({ role: 'patient' }),
    );
  });

  it('validates call lifecycle requests and restricts them to appointment participants', async () => {
    await request(app).post(`/api/consultations/${validId}/calls`).send({ action: 'initiate' }).expect(401);
    await request(app).post(`/api/consultations/${validId}/calls`).set(auth('doctor'))
      .send({ action: 'accept' }).expect(400);
    await request(app).post(`/api/consultations/${validId}/calls`).set(auth('visitor'))
      .send({ action: 'initiate' }).expect(403);
    await request(app).post(`/api/consultations/${validId}/calls`).set(auth('patient'))
      .send({ action: 'initiate' }).expect(200);
    expect(consultations.callAction).toHaveBeenCalledWith(
      validId,
      { action: 'initiate' },
      expect.objectContaining({ role: 'patient' }),
      expect.any(Object),
    );
  });

  it('limits analytics to authorized roles and validates export formats', async () => {
    await request(app).get('/api/reports/analytics').expect(401);
    await request(app).get('/api/reports/analytics?export=x').set(auth('admin')).expect(400);
    await request(app).get('/api/reports/analytics').set(auth('visitor')).expect(403);
    await request(app).get('/api/reports/analytics?export=csv').set(auth('admin')).expect(200);
  });

  it('returns private settings and validates updates', async () => {
    await request(app).get('/api/settings').expect(401);
    await request(app).get('/api/settings').set(auth()).expect(200);
    await request(app).put('/api/settings').set(auth()).send({ font_size: 'gigantic' }).expect(400);
    await request(app).put('/api/settings').set(auth()).send({ font_size: 'large' }).expect(200);
  });
});

describe('Mongo-backed notification, report, and settings services', () => {
  it('preserves filtered notification items, unread count, and pagination metadata', async () => {
    const notificationsCollection = {
      countDocuments: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(5),
      find: jest.fn(() => mongoCursor([{ id: validId, notification_type: 'medicine', read_at: null }])),
    };
    getDb.mockResolvedValueOnce({ collection: () => notificationsCollection });

    await expect(storedNotifications.list(userId, { page: '2', limit: '1', type: 'medicine' }))
      .resolves.toMatchObject({
        items: [{ id: validId, notification_type: 'medicine' }],
        unread_count: 5,
        meta: { page: 2, limit: 1, total: 3, totalPages: 3 },
      });
    expect(notificationsCollection.find).toHaveBeenCalledWith(
      { user_id: userId, notification_type: 'medicine' },
      expect.objectContaining({ projection: expect.objectContaining({ read_at: 1 }) }),
    );
  });

  it('updates settings in Mongo and returns the persisted settings envelope', async () => {
    const user = { id: userId, full_name: 'Synthetic User', preferred_language: 'en' };
    const userSettings = {
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      find: jest.fn(() => mongoCursor([{ key: 'font_size', value: 'large' }])),
    };
    const db = {
      collection: (name) => ({
        users: { findOne: jest.fn().mockResolvedValue(user) },
        user_settings: userSettings,
        patients: { findOne: jest.fn().mockResolvedValue(null) },
        patient_consents: { find: jest.fn(() => mongoCursor()) },
        audit_logs: { insertOne: jest.fn().mockResolvedValue({ acknowledged: true }) },
      })[name],
    };
    getDb.mockResolvedValue(db);

    await expect(storedSettings.update(
      { font_size: 'large' },
      { sub: userId, role: 'doctor' },
      { ip: '127.0.0.1', get: () => 'jest' },
    )).resolves.toMatchObject({ font_size: 'large' });
    expect(userSettings.updateOne).toHaveBeenCalledWith(
      { user_id: userId, key: 'font_size' },
      expect.objectContaining({ $set: { value: 'large', updated_at: expect.any(Date) } }),
      { upsert: true },
    );
  });

  it('returns analytics aggregates from Mongo collections', async () => {
    const db = {
      collection: () => ({
        find: jest.fn(() => mongoCursor()),
        findOne: jest.fn(),
      }),
    };
    getDb.mockResolvedValueOnce(db);

    await expect(storedReports.analytics({}, { sub: userId, role: 'admin' }, {}))
      .resolves.toMatchObject({
        data: {
          total_registrations: 0,
          village_statistics: [],
          screening_statistics: [],
          medicine_adherence: [],
        },
      });
  });

  it('localizes and stores in-app notifications without PostgreSQL', async () => {
    const inserted = [];
    const collections = {
      users: { findOne: jest.fn().mockResolvedValue({ id: userId, preferred_language: 'en', mobile: '9876543210' }) },
      notification_preferences: { findOne: jest.fn().mockResolvedValue({ in_app_enabled: true }) },
      user_settings: { findOne: jest.fn().mockResolvedValue({ value: {} }) },
      translation_contents: { find: jest.fn(() => mongoCursor()) },
      notifications: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: jest.fn(async (notification) => inserted.push(notification)),
      },
    };
    getDb.mockResolvedValueOnce({ collection: (name) => collections[name] });

    const notification = await notificationDelivery.create(
      null,
      userId,
      'appointment',
      { appointment_id: validId },
      { allowedChannels: ['in_app'] },
    );

    expect(notification).toMatchObject({
      user_id: userId,
      notification_type: 'appointment',
      title: 'Appointment update',
      is_read: false,
    });
    expect(inserted).toHaveLength(1);
  });

  it('runs scheduled notification scans using Mongo collections', async () => {
    const db = {
      collection: () => ({
        find: jest.fn(() => mongoCursor()),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      }),
    };
    getDb.mockResolvedValue(db);

    await expect(notificationScheduleJob.dispatchScheduledNotifications(new Date()))
      .resolves.toEqual({ notifications_sent: 0 });
    await expect(medicineReminderJob.dispatchMedicineReminders(new Date()))
      .resolves.toEqual({ notifications_sent: 0 });
  });
});
