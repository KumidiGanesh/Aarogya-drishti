jest.mock('../src/db/mongo', () => ({ getDb: jest.fn() }));

const adminService = require('../src/admin/service');
const { getDb } = require('../src/db/mongo');

function cursor(items = []) {
  const result = {
    sort: jest.fn(() => result),
    skip: jest.fn(() => result),
    limit: jest.fn(() => result),
    toArray: jest.fn(async () => items),
  };
  return result;
}

function collection(overrides = {}) {
  return {
    find: jest.fn(() => cursor()),
    findOne: jest.fn(),
    insertOne: jest.fn(async () => ({ acknowledged: true })),
    updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    updateMany: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
    countDocuments: jest.fn(async () => 0),
    ...overrides,
  };
}

function database(sets = {}) {
  const collections = new Map(Object.entries(sets));
  return {
    collection: jest.fn((name) => {
      if (!collections.has(name)) collections.set(name, collection());
      return collections.get(name);
    }),
  };
}

const request = {
  user: { sub: 'admin-id', role: 'admin' },
  ip: '127.0.0.1',
  get: () => 'jest',
};

describe('admin service Mongo persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prevents admins from creating patient or administrator accounts and reserves Super Admin setup', async () => {
    const common = {
      full_name: 'Synthetic User',
      mobile: '9876543210',
      password: 'StrongPass1',
      preferred_language: 'en',
      profile: {},
    };
    await expect(adminService.createUser({ ...common, role: 'patient' }, request))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(adminService.createUser({ ...common, role: 'admin' }, request))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(adminService.createUser({ ...common, role: 'patient' }, {
      ...request,
      user: { sub: 'super-admin-id', role: 'super_admin' },
    })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(adminService.createUser({ ...common, role: 'super_admin' }, {
      ...request,
      user: { sub: 'super-admin-id', role: 'super_admin' },
    })).rejects.toMatchObject({ status: 403, code: 'SUPER_ADMIN_SETUP_ONLY' });
    expect(getDb).not.toHaveBeenCalled();
  });

  it('includes pending administrator requests in the pending user filter', async () => {
    const pendingAdmin = {
      id: 'pending-admin-id',
      full_name: 'Pending Admin',
      email: 'pending-admin@example.test',
      admin_id: 'PENDING-01',
      username: 'pendingadmin',
      mobile: '9876543210',
      role: 'admin',
      is_active: false,
      admin_registration_status: 'pending',
      created_at: new Date(),
    };
    getDb.mockResolvedValue(database({
      users: collection({ find: jest.fn(() => cursor([pendingAdmin])) }),
    }));

    const result = await adminService.listUsers(
      { status: 'pending', role: 'admin' },
      { page: 1, limit: 10, offset: 0 },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: pendingAdmin.id,
      pending_approval: true,
      account_status: 'pending_approval',
      admin_id: 'PENDING-01',
    });
  });

  it('lists soft-deleted patient accounts with existing profiles for authorized reactivation', async () => {
    const patientUser = {
      id: 'deleted-patient-user',
      full_name: 'Synthetic Patient',
      mobile: '9876543210',
      role: 'patient',
      is_active: false,
      deleted_at: new Date(),
      created_at: new Date(),
    };
    const patientProfile = {
      id: 'existing-patient-profile',
      patient_code: 'AD-2026-000001',
      user_id: patientUser.id,
      mobile: patientUser.mobile,
      is_active: true,
      deleted_at: null,
    };
    const users = collection({ find: jest.fn(() => cursor([patientUser])) });
    getDb.mockResolvedValue(database({
      users,
      patients: collection({ find: jest.fn(() => cursor([patientProfile])) }),
    }));

    const result = await adminService.listUsers(
      { role: 'patient', status: 'inactive' },
      { page: 1, limit: 10, offset: 0 },
    );

    expect(users.find).toHaveBeenCalledWith({
      $or: [
        { deleted_at: null },
        { role: 'patient', deleted_at: { $ne: null } },
      ],
    });
    expect(result.items).toMatchObject([
      { id: patientUser.id, role: 'patient', is_active: false, account_status: 'inactive' },
    ]);
  });

  it('reactivates a soft-deleted patient account and its existing profile without replacing either record', async () => {
    const patientId = 'c8c0f6e3-1c53-4df7-a9b9-7f28bd34bb31';
    const patientUser = {
      id: patientId,
      full_name: 'Synthetic Patient',
      mobile: '9876543210',
      role: 'patient',
      is_active: false,
      deleted_at: new Date(),
      permissions_version: 1,
    };
    const activeUser = { ...patientUser, is_active: true, deleted_at: null };
    const users = collection({
      findOne: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(patientUser)
        .mockResolvedValueOnce(activeUser),
    });
    const patients = collection({
      findOne: jest.fn().mockResolvedValue({ id: 'existing-profile', user_id: patientId }),
    });
    const roles = collection({
      findOne: jest.fn().mockResolvedValue({ name: 'patient', permissions: ['patients:self:read'] }),
    });
    const auditLogs = collection({ find: jest.fn(() => cursor()) });
    getDb.mockResolvedValue(database({
      users,
      patients,
      roles,
      audit_logs: auditLogs,
      refresh_tokens: collection(),
    }));

    const result = await adminService.updateUser(patientId, { is_active: true }, request);

    expect(users.updateOne).toHaveBeenCalledWith({ id: patientId }, {
      $set: expect.objectContaining({ is_active: true, deleted_at: null }),
    });
    expect(patients.updateOne).toHaveBeenCalledWith(
      { user_id: patientId, deleted_at: null },
      { $set: { is_active: true, updated_at: expect.any(Date) } },
    );
    expect(result.user).toMatchObject({
      id: patientId,
      role: 'patient',
      is_active: true,
      account_status: 'active',
    });
    expect(auditLogs.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      action: 'admin.patient.account_reactivated',
      entity_id: patientId,
      metadata: expect.objectContaining({ restored_from_soft_delete: true }),
    }));
  });

  it('rejects duplicate Admin IDs before attempting account creation', async () => {
    const users = collection({
      findOne: jest.fn(async (query) => (
        query.admin_id ? { id: 'existing-admin-id' } : null
      )),
    });
    getDb.mockResolvedValue(database({ users }));

    await expect(adminService.createUser({
      full_name: 'Another Admin',
      email: 'another-admin@example.test',
      mobile: '9876543211',
      password: 'StrongPass1',
      confirm_password: 'StrongPass1',
      username: 'anotheradmin',
      admin_id: 'admin-007',
      preferred_language: 'en',
      role: 'admin',
      profile: {},
    }, {
      ...request,
      user: { sub: 'super-admin-id', role: 'super_admin' },
    })).rejects.toMatchObject({ status: 409, code: 'ADMIN_ID_EXISTS' });

    expect(users.findOne).toHaveBeenCalledWith({
      admin_id: 'ADMIN-007',
      deleted_at: null,
    });
    expect(users.insertOne).not.toHaveBeenCalled();
  });

  it('prevents a Super Admin from promoting an existing account to Super Admin', async () => {
    const users = collection({
      findOne: jest.fn().mockResolvedValue({
        id: 'existing-user',
        role: 'admin',
        is_active: true,
        deleted_at: null,
      }),
    });
    getDb.mockResolvedValue(database({ users }));

    await expect(adminService.updateUser('existing-user', { role: 'super_admin' }, {
      ...request,
      user: { sub: 'super-admin-id', role: 'super_admin' },
    })).rejects.toMatchObject({ status: 403, code: 'SUPER_ADMIN_SETUP_ONLY' });

    expect(users.updateOne).not.toHaveBeenCalled();
  });

  it('updates role permissions, bumps the role version, revokes sessions, and audits the change', async () => {
    const role = {
      name: 'doctor',
      description: 'Doctor',
      permissions: ['patients:read', 'screenings:read'],
      permissions_version: 4,
    };
    const roles = collection({ findOne: jest.fn().mockResolvedValue(role) });
    const users = collection({
      find: jest.fn(() => cursor([{ id: 'doctor-user' }])),
    });
    const refreshTokens = collection();
    const audits = collection();
    getDb.mockResolvedValue(database({
      roles,
      users,
      refresh_tokens: refreshTokens,
      audit_logs: audits,
    }));

    const updated = await adminService.updateRolePermissions('doctor', ['screenings:read'], {
      ...request,
      user: { sub: 'super-admin-id', role: 'super_admin' },
    });

    expect(updated).toMatchObject({
      name: 'doctor',
      permissions: ['screenings:read'],
      permissions_version: 5,
    });
    expect(roles.updateOne).toHaveBeenCalledWith(
      { name: 'doctor', permissions_version: 4 },
      { $set: expect.objectContaining({ permissions_version: 5 }) },
    );
    expect(users.updateMany).toHaveBeenCalledWith(
      { id: { $in: ['doctor-user'] } },
      { $set: expect.objectContaining({ permissions_version: 5 }) },
    );
    expect(refreshTokens.updateMany).toHaveBeenCalledWith(
      { user_id: { $in: ['doctor-user'] }, revoked_at: null },
      { $set: { revoked_at: expect.any(Date) } },
    );
    expect(audits.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      action: 'admin.roles.permissions_updated',
      entity_id: 'doctor',
    }));
  });

  it('does not let administrators or the super administrator role weaken super administrator permissions', async () => {
    await expect(adminService.updateRolePermissions('doctor', [], request))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(adminService.updateRolePermissions('super_admin', [], {
      ...request,
      user: { sub: 'super-admin-id', role: 'super_admin' },
    })).rejects.toMatchObject({ status: 409, code: 'SUPER_ADMIN_PERMISSIONS_LOCKED' });
    expect(getDb).not.toHaveBeenCalled();
  });

  it('audits doctor application approval against the target user', async () => {
    const doctorId = 'e1c548b7-3329-4afe-a08a-858449f42014';
    const current = {
      id: doctorId,
      role: 'doctor',
      is_active: false,
      full_name: 'Synthetic Doctor',
      mobile: '9876543210',
      preferred_language: 'en',
      deleted_at: null,
    };
    const updated = { ...current, is_active: true };
    const users = collection({ findOne: jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated) });
    const roles = collection({ findOne: jest.fn().mockResolvedValue({ permissions: ['patients:read'] }) });
    const audits = collection({
      find: jest.fn(() => cursor([{
        user_id: doctorId,
        action: 'auth.doctor.registration_requested',
        entity: 'users',
        entity_id: doctorId,
      }])),
    });
    const db = database({
      users,
      roles,
      audit_logs: audits,
      refresh_tokens: collection(),
      doctors: collection(),
    });
    getDb.mockResolvedValue(db);

    await adminService.updateUser(doctorId, { is_active: true, profile: {} }, request);

    expect(audits.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'admin-id',
      action: 'admin.doctor.registration_approved',
      entity: 'users',
      entity_id: doctorId,
    }));
    expect(users.updateOne).toHaveBeenCalledWith({ id: doctorId }, {
      $set: expect.objectContaining({ is_active: true }),
    });
  });

  it('does not allow generic user edits to activate a pending doctor request', async () => {
    const users = collection({
      findOne: jest.fn().mockResolvedValue({
        id: 'pending-doctor-id',
        role: 'doctor',
        is_active: false,
        doctor_request_status: 'pending',
        deleted_at: null,
      }),
    });
    getDb.mockResolvedValue(database({ users }));

    await expect(adminService.updateUser(
      'pending-doctor-id',
      { is_active: true },
      request,
    )).rejects.toMatchObject({ status: 409, code: 'DOCTOR_APPROVAL_REQUIRED' });
    expect(users.updateOne).not.toHaveBeenCalled();
  });

  it('persists administrator-configured doctor availability', async () => {
    const doctorId = 'c2c75eb4-fd59-429f-91bb-0e2179c00f30';
    const current = {
      id: doctorId,
      role: 'doctor',
      is_active: true,
      deleted_at: null,
    };
    const users = collection({ findOne: jest.fn().mockResolvedValue(current) });
    const doctors = collection();
    const db = database({
      users,
      roles: collection({ findOne: jest.fn().mockResolvedValue({ permissions: [] }) }),
      audit_logs: collection(),
      doctors,
    });
    getDb.mockResolvedValue(db);

    await adminService.updateUser(doctorId, {
      profile: { availability: { '1': ['09:00', '09:30'] } },
    }, request);

    expect(doctors.updateOne).toHaveBeenCalledWith(
      { user_id: doctorId },
      { $set: { availability: { '1': ['09:00', '09:30'] }, updated_at: expect.any(Date) } },
    );
  });

  it('creates formula-safe CSV exports and complete multi-page PDF exports', async () => {
    const users = Array.from({ length: 60 }, (_, index) => ({
      id: `user-${index}`,
      full_name: index === 0 ? '=DEMO()' : `Synthetic User ${index}`,
      created_at: new Date('2026-10-30T00:00:00.000Z'),
      deleted_at: null,
      is_active: true,
    }));
    const db = database({
      users: collection({ find: jest.fn(() => cursor(users)) }),
      patients: collection({ find: jest.fn(() => cursor()) }),
      roles: collection({ find: jest.fn(() => cursor()) }),
      audit_logs: collection(),
    });
    getDb.mockResolvedValue(db);

    const csv = await adminService.report({ type: 'users', format: 'csv' }, request);
    const pdf = await adminService.report({ type: 'users', format: 'pdf' }, request);

    expect(csv.content).toContain('"\'=DEMO()"');
    expect(pdf.content.subarray(0, 8).toString()).toBe('%PDF-1.4');
    expect(pdf.content.toString()).toContain('/Count 2');
  });

  it('keeps the demonstration warning and safety sentence in screening exports', async () => {
    const screening = {
      id: 'screening-id',
      patient_id: 'patient-id',
      status: 'ai_completed',
      screened_at: new Date('2026-10-30T00:00:00.000Z'),
      created_at: new Date('2026-10-30T00:00:00.000Z'),
    };
    const db = database({
      users: collection(),
      patients: collection({ find: jest.fn(() => cursor([{ id: 'patient-id', patient_code: 'AD-2026-000001' }])) }),
      oral_screenings: collection({ find: jest.fn(() => cursor([screening])) }),
      ai_screening_results: collection({
        find: jest.fn(() => cursor([{
          screening_id: 'screening-id',
          risk_category: 'moderate',
          is_demo: true,
          disclaimer: 'DEMO AI OUTPUT - NOT FOR CLINICAL USE',
          result_data: {
            safety_sentence: 'This tool does not diagnose and does not replace professional medical evaluation.',
          },
        }])),
      }),
      audit_logs: collection(),
    });
    getDb.mockResolvedValue(db);

    const csv = await adminService.report({ type: 'screenings', format: 'csv' }, request);
    const pdf = await adminService.report({ type: 'screenings', format: 'pdf' }, request);

    expect(csv.content).toContain('"DEMO AI OUTPUT - NOT FOR CLINICAL USE"');
    expect(csv.content).toContain('"This tool does not diagnose and does not replace professional medical evaluation."');
    expect(pdf.content.toString()).toContain('DEMO AI OUTPUT - NOT FOR CLINICAL USE');
    expect(pdf.content.toString()).toContain('This tool does not diagnose and does not replace professional medical evaluation.');
  });

  it('prevents deletion of the last active super administrator', async () => {
    const users = collection({
      findOne: jest.fn().mockResolvedValue({ id: 'target-id', role: 'super_admin', deleted_at: null }),
      countDocuments: jest.fn().mockResolvedValue(0),
    });
    const db = database({ users });
    getDb.mockResolvedValue(db);

    await expect(adminService.deleteUser('target-id', {
      ...request,
      user: { sub: 'other-id', role: 'super_admin' },
    })).rejects.toMatchObject({ status: 409, code: 'LAST_SUPER_ADMIN' });
    expect(users.updateOne).not.toHaveBeenCalled();
  });
});
