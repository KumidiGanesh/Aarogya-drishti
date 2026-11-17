process.env.JWT_ACCESS_SECRET = 'admin-test-access-secret-at-least-32-characters';

let mockActiveRole = 'admin';

jest.mock('../src/db/mongo', () => ({
  getDb: jest.fn(async () => ({
    collection: (name) => ({
      findOne: async (filter) => (name === 'users'
        ? { id: filter.id, role: mockActiveRole, is_active: true, deleted_at: null, permissions_version: 1 }
        : name === 'roles'
          ? { name: filter.name, is_system: true, permissions_version: 1 }
          : { id: filter.id, user_id: filter.user_id, revoked_at: null, expires_at: new Date(Date.now() + 60000) }),
    }),
  })),
}));

jest.mock('../src/admin/service', () => ({
  dashboard: jest.fn(),
  listRoles: jest.fn(),
  updateRolePermissions: jest.fn(),
  createUser: jest.fn(),
  listUsers: jest.fn(),
  getUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  reviewDoctorRegistration: jest.fn(),
  reviewAdminRegistration: jest.fn(),
  report: jest.fn(),
  listAuditLogs: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const adminService = require('../src/admin/service');

const userId = '2a840c79-4973-4f3e-bec4-e8588016c794';
const adminUser = {
  id: userId,
  full_name: 'Demo Doctor',
  mobile: '9876543210',
  role: 'doctor',
  permissions: ['patients:read'],
  is_active: true,
};

const { DEFAULT_ROLE_PERMISSIONS } = require('../src/auth/permissions');

function token(role = 'admin', permissions = DEFAULT_ROLE_PERMISSIONS[role] || []) {
  const sessionId =
    {
      admin: 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
      super_admin: 'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2',
      doctor: 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
      health_worker: 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4',
      patient: 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5',
    }[role] || 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6';
  mockActiveRole = role;
  return jwt.sign({ role, permissions, pv: 1, sid: sessionId }, process.env.JWT_ACCESS_SECRET, {
    subject: '7c31cbd1-ef65-4e8d-a526-c90dfb51192d',
    expiresIn: '5m',
  });
}

function as(role = 'admin', permissions) {
  return { Authorization: `Bearer ${token(role, permissions)}` };
}

beforeEach(() => {
  jest.clearAllMocks();
  adminService.dashboard.mockResolvedValue({
    totalPatients: 1,
    totalDoctors: 1,
    totalHealthWorkers: 0,
    totalSpecialists: 0,
    totalHospitals: 1,
    totalAppointments: 0,
    pendingReferrals: 0,
    completedConsultations: 0,
    emergencyRequests: 0,
    recentRegistrations: [],
    registrationTrend: { days7: [], days30: [] },
  });
  adminService.listRoles.mockResolvedValue({ roles: [], permissions: [] });
  adminService.updateRolePermissions.mockResolvedValue({
    name: 'doctor',
    permissions: ['patients:read'],
    permissions_version: 2,
  });
  adminService.reviewDoctorRegistration.mockResolvedValue({ ...adminUser, is_active: true });
  adminService.reviewAdminRegistration.mockResolvedValue({ ...adminUser, is_active: true });
  adminService.createUser.mockResolvedValue(adminUser);
  adminService.listUsers.mockResolvedValue({
    items: [adminUser],
    meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
  });
  adminService.getUser.mockResolvedValue({
    ...adminUser,
    profile: null,
    registrationHistory: [],
    recentActivity: [],
  });
  adminService.updateUser.mockResolvedValue({ user: adminUser, temporaryPassword: null });
  adminService.deleteUser.mockResolvedValue(undefined);
  adminService.report.mockResolvedValue({
    format: 'json',
    content: [{ id: userId }],
    filename: 'users-report.json',
  });
  adminService.listAuditLogs.mockResolvedValue({
    items: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
});

describe('admin endpoints', () => {
  it('serves all twelve admin endpoints with the standard envelope and status codes', async () => {
    const superAdminAuth = as('super_admin');
    await request(app).get('/api/admin/roles').set(superAdminAuth).expect(200);
    await request(app).put('/api/admin/roles/doctor/permissions')
      .set(superAdminAuth)
      .send({ permissions: ['patients:read'] })
      .expect(200);

    const auth = as();
    const adminReview = await request(app)
      .put(`/api/admin/users/${userId}/admin-registration`)
      .set(as('super_admin'))
      .send({ decision: 'approved' });
    as();
    const responses = await Promise.all([
      request(app).get('/api/admin/dashboard').set(auth),
      request(app)
        .post('/api/admin/users')
        .set(auth)
        .send({
          full_name: 'Demo Doctor',
          mobile: '9876543210',
          password: 'StrongPass1',
          role: 'doctor',
          profile: { registration_number: 'DEMO-DOC-900' },
        }),
      request(app).get('/api/admin/users?page=1&limit=10').set(auth),
      request(app).get(`/api/admin/users/${userId}`).set(auth),
      request(app).put(`/api/admin/users/${userId}`).set(auth).send({ full_name: 'Updated Demo' }),
      request(app).put(`/api/admin/users/${userId}/doctor-registration`)
        .set(auth)
        .send({ decision: 'approved' }),
      request(app).delete(`/api/admin/users/${userId}`).set(auth),
      request(app).get('/api/admin/reports?type=users&format=json').set(auth),
      request(app).get('/api/admin/audit-logs?page=1&limit=20').set(auth),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      200, 201, 200, 200, 200, 200, 204, 200, 200,
    ]);
    expect(adminReview.status).toBe(200);
    responses.push(adminReview);
    for (const response of responses.filter((item) => item.status !== 204)) {
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
    }
  });

  it('returns 400 for invalid parameters and pagination', async () => {
    const invalidId = await request(app).get('/api/admin/users/not-a-uuid').set(as());
    const invalidPage = await request(app).get('/api/admin/users?page=0').set(as());
    const invalidReport = await request(app).get('/api/admin/reports?type=unknown').set(as());

    expect(invalidId.status).toBe(400);
    expect(invalidPage.status).toBe(400);
    expect(invalidReport.status).toBe(400);
    expect(invalidId.body.code).toBe('VALIDATION_ERROR');
    expect(invalidPage.body.code).toBe('INVALID_PAGINATION');
    expect(invalidReport.body.code).toBe('VALIDATION_ERROR');
  });

  it('accepts administrator-configured doctor schedules and rejects invalid slots', async () => {
    const saved = await request(app)
      .put(`/api/admin/users/${userId}`)
      .set(as('super_admin'))
      .send({ profile: { availability: { '1': ['09:00', '09:30'] } } });
    const invalid = await request(app)
      .put(`/api/admin/users/${userId}`)
      .set(as('super_admin'))
      .send({ profile: { availability: { '1': ['09:00', '09:00'] } } });

    expect(saved.status).toBe(200);
    expect(adminService.updateUser).toHaveBeenCalledWith(
      userId,
      { profile: { availability: { '1': ['09:00', '09:30'] } } },
      expect.objectContaining({ user: expect.objectContaining({ role: 'super_admin' }) }),
    );
    expect(invalid.status).toBe(400);
    expect(adminService.updateUser).toHaveBeenCalledTimes(1);
  });

  it('rejects patient login accounts even when requested by a super administrator', async () => {
    const response = await request(app)
      .post('/api/admin/users')
      .set(as('super_admin'))
      .send({
        full_name: 'Synthetic Patient',
        mobile: '9876543210',
        password: 'StrongPass1',
        role: 'patient',
        profile: {},
      });
    const roleChange = await request(app)
      .put(`/api/admin/users/${userId}`)
      .set(as('super_admin'))
      .send({ role: 'patient' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(roleChange.status).toBe(400);
    expect(roleChange.body.code).toBe('VALIDATION_ERROR');
    expect(adminService.createUser).not.toHaveBeenCalled();
    expect(adminService.updateUser).not.toHaveBeenCalled();
  });

  it('validates input on all admin endpoints that accept validated input', async () => {
    const auth = as();
    const responses = await Promise.all([
      request(app)
        .get(`/api/admin/dashboard?district=${'x'.repeat(101)}`)
        .set(auth),
      request(app).post('/api/admin/users').set(auth).send({ full_name: '' }),
      request(app).get('/api/admin/users?limit=101').set(auth),
      request(app).get('/api/admin/users/not-a-uuid').set(auth),
      request(app).put(`/api/admin/users/${userId}`).set(auth).send({}),
      request(app).delete('/api/admin/users/not-a-uuid').set(auth),
      request(app).get('/api/admin/reports?type=unknown').set(auth),
      request(app).get('/api/admin/audit-logs?page=0').set(auth),
    ]);

    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(400));
    expect(adminService.dashboard).not.toHaveBeenCalled();
    expect(adminService.createUser).not.toHaveBeenCalled();
    expect(adminService.listUsers).not.toHaveBeenCalled();
    expect(adminService.getUser).not.toHaveBeenCalled();
    expect(adminService.updateUser).not.toHaveBeenCalled();
    expect(adminService.deleteUser).not.toHaveBeenCalled();
    expect(adminService.report).not.toHaveBeenCalled();
    expect(adminService.listAuditLogs).not.toHaveBeenCalled();
  });

  it('requires authentication and denies every non-admin role from all admin routes', async () => {
    const protectedPaths = [
      ['get', '/api/admin/dashboard'],
      ['post', '/api/admin/users'],
      ['get', '/api/admin/users'],
      ['get', `/api/admin/users/${userId}`],
      ['put', `/api/admin/users/${userId}`],
      ['put', `/api/admin/users/${userId}/admin-registration`],
      ['delete', `/api/admin/users/${userId}`],
      ['get', '/api/admin/reports?type=users'],
      ['get', '/api/admin/audit-logs'],
    ];
    for (const [method, path] of protectedPaths) {
      const anonymous = await request(app)[method](path);
      expect(anonymous.status).toBe(401);
    }
    for (const role of ['doctor', 'health_worker', 'patient']) {
      for (const [method, path] of protectedPaths) {
        const response = await request(app)[method](path).set(as(role));
        expect(response.status).toBe(403);
        expect(response.body.code).toBe(
          ['doctor', 'patient'].includes(role) ? 'FORBIDDEN' : 'ROLE_NOT_AUTHORIZED',
        );
      }
    }
    expect(adminService.dashboard).not.toHaveBeenCalled();
  });

  it('enforces the export permission independently of the admin role', async () => {
    const response = await request(app)
      .get('/api/admin/reports?type=users')
      .set(as('admin', ['users:read', 'users:manage']));

    expect(response.status).toBe(403);
    expect(adminService.report).not.toHaveBeenCalled();
  });

  it('reserves administrator account review for Super Admins', async () => {
    const response = await request(app)
      .put(`/api/admin/users/${userId}/admin-registration`)
      .set(as('admin'))
      .send({ decision: 'approved' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(adminService.reviewAdminRegistration).not.toHaveBeenCalled();
  });
});
