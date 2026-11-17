process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters';

const mockVerifyRequests = [];
const mockVerifyChecks = [];
const mockEmailMessages = [];
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const mockEmailOtpAdapter = {
  isConfigured: jest.fn(() => true),
  sendEmail: jest.fn(async (message) => {
    mockEmailMessages.push(message);
    return { delivered: true };
  }),
};
jest.mock('../src/db/mongo', () => require('./helpers/mongoMock'));
jest.mock('../src/utils/logger', () => mockLogger);
jest.mock('../src/auth/twilioVerifyAdapter', () => ({
  sendVerification: jest.fn(async (to) => {
    mockVerifyRequests.push(to);
    return { delivered: true };
  }),
  checkVerification: jest.fn(async (to, code) => {
    mockVerifyChecks.push({ to, code });
    return { approved: code === '123456' };
  }),
}));
jest.mock('../src/auth/emailOtpAdapter', () => mockEmailOtpAdapter);

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongo = require('./helpers/mongoMock');
const twilioVerifyAdapter = require('../src/auth/twilioVerifyAdapter');
const authService = require('../src/auth/service');
const otpService = require('../src/auth/otpService');
const adminService = require('../src/admin/service');

const req = {
  ip: '127.0.0.1',
  get: () => 'jest',
};

function addRole(name, permissions = []) {
  mongo.insert('roles', {
    id: `${name}-role`,
    name,
    is_system: true,
    permissions,
    permissions_version: 1,
  });
}

function addUser(overrides = {}) {
  const user = {
    id: '2a840c79-4973-4f3e-bec4-e8588016c794',
    full_name: 'Synthetic Doctor',
    email: 'doctor@demo.example.test',
    mobile: '9876543210',
    password_hash: bcrypt.hashSync('RightPass1', 4),
    preferred_language: 'en',
    role: 'doctor',
    permissions_version: 1,
    failed_login_count: 0,
    locked_until: null,
    is_active: true,
    deleted_at: null,
    ...overrides,
  };
  mongo.insert('users', user);
  return user;
}

function doctorRegistration(overrides = {}) {
  return {
    account_type: 'doctor',
    full_name: 'Synthetic Doctor',
    mobile: '9876543210',
    email: 'doctor@demo.example.test',
    password: 'StrongPass1',
    preferred_language: 'en',
    registration_number: 'DEMO-REG-123',
    specialty: 'Oral health',
    facility_name: 'Demo PHC',
    district: 'Demo district',
    ...overrides,
  };
}

describe('MongoDB authentication service security behavior', () => {
  beforeEach(() => {
    mongo.reset();
    mockVerifyRequests.length = 0;
    mockVerifyChecks.length = 0;
    mockEmailMessages.length = 0;
    mockEmailOtpAdapter.isConfigured.mockReset().mockReturnValue(true);
    mockEmailOtpAdapter.sendEmail.mockReset().mockImplementation(async (message) => {
      mockEmailMessages.push(message);
      return { delivered: true };
    });
    twilioVerifyAdapter.sendVerification.mockReset().mockImplementation(async (to) => {
      mockVerifyRequests.push(to);
      return { delivered: true };
    });
    twilioVerifyAdapter.checkVerification.mockReset().mockImplementation(async (to, code) => {
      mockVerifyChecks.push({ to, code });
      return { approved: code === '123456' };
    });
  });

  it('stores doctor account requests inactive until reviewed by an administrator', async () => {
    addRole('doctor');
    const doctor = await authService.register(doctorRegistration(), req);

    expect(doctor).toMatchObject({
      role: 'doctor',
      account_status: 'pending_approval',
      pending_approval: true,
    });
    expect(mongo.all('users')[0]).toMatchObject({
      role: 'doctor',
      is_active: false,
      doctor_request_status: 'pending',
      email_verified_at: null,
    });
    expect(mongo.all('otp_grants')).toHaveLength(0);
    expect(await bcrypt.compare('StrongPass1', mongo.all('users')[0].password_hash)).toBe(true);
    expect(mongo.all('doctors')[0]).toMatchObject({
      user_id: doctor.id,
      registration_number: 'DEMO-REG-123',
      qualification: '',
      specialty: 'Oral health',
      facility_name: 'Demo PHC',
      district: 'Demo district',
    });
    expect(mongo.all('audit_logs')[0].action).toBe('auth.doctor.registration_requested');
  });

  it('completes doctor request, admin approval, login, JWT verification, and refresh rotation', async () => {
    addRole('doctor', ['patients:read']);
    const doctorRequest = await authService.register(doctorRegistration({
      full_name: 'Workflow Doctor',
      mobile: '9876543210',
      email: 'workflow-doctor@example.test',
      registration_number: 'DEMO-REG-WORKFLOW',
    }), req);
    await expect(authService.login('workflow-doctor@example.test', 'StrongPass1', req, 'doctor'))
      .rejects.toMatchObject({ status: 403, code: 'DOCTOR_APPROVAL_PENDING' });
    await expect(authService.login('workflow-doctor@example.test', 'WrongPass1', req, 'doctor'))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    await expect(authService.login('missing-doctor@example.test', 'StrongPass1', req, 'doctor'))
      .rejects.toMatchObject({ status: 404, code: 'DOCTOR_ACCOUNT_NOT_FOUND' });

    const adminReq = {
      ...req,
      user: { sub: 'administrator-id', role: 'admin' },
    };
    const approved = await adminService.reviewDoctorRegistration(
      doctorRequest.id,
      'approved',
      adminReq,
    );
    expect(approved).toMatchObject({
      id: doctorRequest.id,
      is_active: true,
      doctor_request_status: 'approved',
      account_status: 'active',
    });

    const login = await authService.login('workflow-doctor@example.test', 'StrongPass1', req, 'doctor');
    expect(jwt.verify(login.accessToken, process.env.JWT_ACCESS_SECRET)).toMatchObject({
      sub: doctorRequest.id,
      role: 'doctor',
    });
    expect(login.user).toMatchObject({ id: doctorRequest.id, role: 'doctor' });

    const refreshed = await authService.rotateRefreshToken(login.refreshToken, req);
    expect(refreshed.user).toMatchObject({ id: doctorRequest.id, role: 'doctor' });
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(login.refreshToken);
  });

  it('keeps rejected doctor requests inactive and reports their status on login', async () => {
    addRole('doctor');
    const doctorRequest = await authService.register(doctorRegistration({
      full_name: 'Rejected Workflow Doctor',
      mobile: '9876543211',
      email: 'rejected-doctor@example.test',
      registration_number: 'DEMO-REG-REJECTED',
    }), req);

    await adminService.reviewDoctorRegistration(
      doctorRequest.id,
      'rejected',
      { ...req, user: { sub: 'administrator-id', role: 'admin' } },
    );

    expect(mongo.all('users')[0]).toMatchObject({
      is_active: false,
      doctor_request_status: 'rejected',
    });
    await expect(authService.login('rejected-doctor@example.test', 'StrongPass1', req, 'doctor'))
      .rejects.toMatchObject({ status: 403, code: 'DOCTOR_REGISTRATION_REJECTED' });
    expect(mongo.all('refresh_tokens')).toHaveLength(0);
  });

  it('requires Super Admin approval before an administrator can log in', async () => {
    addRole('admin', ['users:read']);
    const admin = await adminService.createUser({
      full_name: 'Pending Admin',
      email: 'pending-admin@example.test',
      mobile: '9876543211',
      username: 'pendingadmin',
      password: 'RightPass1',
      confirm_password: 'RightPass1',
      preferred_language: 'en',
      role: 'admin',
      profile: {},
    }, {
      ...req,
      user: { sub: 'super-admin-id', role: 'super_admin' },
    });

    expect(admin).toMatchObject({
      admin_id: 'PENDINGADMIN',
      username: 'pendingadmin',
      is_active: false,
      admin_registration_status: 'pending',
      pending_approval: true,
    });
    expect(await bcrypt.compare('RightPass1', mongo.all('users')[0].password_hash)).toBe(true);
    await expect(authService.login(admin.username, 'RightPass1', req, 'admin'))
      .rejects.toMatchObject({ status: 403, code: 'ADMIN_APPROVAL_PENDING' });
    const approved = await adminService.reviewAdminRegistration(admin.id, 'approved', {
      ...req,
      user: { sub: 'super-admin-id', role: 'super_admin' },
    });
    expect(approved).toMatchObject({
      is_active: true,
      admin_registration_status: 'approved',
      account_status: 'active',
    });
    const login = await authService.login(admin.username, 'RightPass1', req, 'admin');
    expect(login.user).toMatchObject({ id: admin.id, role: 'admin', username: 'pendingadmin' });
  });

  it('blocks rejected administrator registrations from logging in', async () => {
    addRole('admin');
    const admin = addUser({
      id: 'rejected-admin-id',
      email: 'rejected-admin@example.test',
      role: 'admin',
      is_active: false,
      admin_registration_status: 'rejected',
      admin_id: 'REJECTED-01',
    });

    await expect(authService.login(admin.email, 'RightPass1', req, 'admin'))
      .rejects.toMatchObject({ status: 403, code: 'ADMIN_REGISTRATION_REJECTED' });
  });

  it('resets an administrator password only after verified email OTP and revokes sessions', async () => {
    addRole('admin');
    const admin = addUser({
      id: 'recoverable-admin-id',
      email: 'recoverable-admin@example.test',
      role: 'admin',
      admin_registration_status: 'approved',
    });
    mongo.insert('refresh_tokens', {
      id: 'admin-session',
      user_id: admin.id,
      revoked_at: null,
    });
    const previousEnvironment = process.env.NODE_ENV;
    const previousDemoSetting = process.env.PATIENT_DEMO_OTP_ENABLED;
    process.env.NODE_ENV = 'development';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'false';
    try {
      const challenge = await otpService.requestOtp({
        target: 'RECOVERABLE-ADMIN@EXAMPLE.TEST',
        purpose: 'admin_password_reset',
      });
      const verified = await otpService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: mockEmailMessages.at(-1).code,
        purpose: 'admin_password_reset',
      });
      await authService.resetAdminPassword({
        email: admin.email,
        verification_token: verified.verification_token,
        password: 'NewStrongPass2',
      }, req);
    } finally {
      process.env.NODE_ENV = previousEnvironment;
      if (previousDemoSetting === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = previousDemoSetting;
    }

    expect(await bcrypt.compare('NewStrongPass2', mongo.all('users')[0].password_hash)).toBe(true);
    expect(new Date(mongo.all('refresh_tokens')[0].revoked_at).getTime()).toBeGreaterThan(0);
    expect(mongo.all('audit_logs').some(({ action }) => action === 'auth.admin.password_reset')).toBe(true);
    await expect(authService.login(admin.email, 'RightPass1', req, 'admin'))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    await expect(authService.login(admin.email, 'NewStrongPass2', req, 'admin'))
      .resolves.toMatchObject({ user: { id: admin.id, role: 'admin' } });
  });

  it('locks an active staff account after five failed password attempts', async () => {
    addRole('doctor');
    addUser();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        authService.login('doctor@demo.example.test', 'WrongPass1', req, 'doctor'),
      ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    }

    const saved = mongo.all('users')[0];
    expect(saved.failed_login_count).toBe(5);
    expect(new Date(saved.locked_until).getTime()).toBeGreaterThan(Date.now());
    await expect(
      authService.login('doctor@demo.example.test', 'WrongPass1', req, 'doctor'),
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(mongo.all('users')[0].failed_login_count).toBe(5);
  });

  it('rejects credentials used with a different login category', async () => {
    addRole('doctor');
    addUser();

    await expect(
      authService.login('doctor@demo.example.test', 'RightPass1', req, 'admin'),
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(mongo.all('refresh_tokens')).toHaveLength(0);
    expect(mongo.all('audit_logs')[0].action).toBe('auth.login.failure');
  });

  it('allows patients to sign in only with a verified mobile OTP', async () => {
    addRole('patient');
    const user = addUser({ role: 'patient', email: 'patient@demo.example.test' });
    mongo.insert('patients', {
      id: 'patient-profile-id',
      user_id: user.id,
      mobile: user.mobile,
      is_active: true,
      deleted_at: null,
    });
    const previousEnvironment = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'development';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'false';
    let result;
    try {
      const challenge = await otpService.requestOtp({
        target: '9876543210',
        purpose: 'patient_login',
      });
      result = await authService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: '123456',
        purpose: 'patient_login',
      }, req);
    } finally {
      if (previousEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment.nodeEnv;
      if (previousEnvironment.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = previousEnvironment.enabled;
    }
    expect(result.user.role).toBe('patient');
    expect(result.user.must_change_password).toBe(false);
    expect(mongo.all('refresh_tokens')).toHaveLength(1);
  });

  it('links an existing patient profile without a login account after mobile OTP verification', async () => {
    const previousEnvironment = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'development';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'true';
    addRole('patient');
    mongo.insert('patients', {
      id: 'legacy-patient-id',
      patient_code: 'AD-2020-000001',
      full_name: 'Legacy Patient',
      mobile: '+91 98765 43210',
      preferred_language: 'en',
      is_active: true,
      deleted_at: null,
    });

    let result;
    try {
      const challenge = await otpService.requestOtp({
        target: '9876543210',
        purpose: 'patient_login',
      });
      result = await authService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: challenge.demo_otp,
        purpose: 'patient_login',
      }, req);
    } finally {
      if (previousEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment.nodeEnv;
      if (previousEnvironment.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = previousEnvironment.enabled;
    }

    expect(result.user).toMatchObject({ role: 'patient', full_name: 'Legacy Patient' });
    expect(jwt.verify(result.accessToken, process.env.JWT_ACCESS_SECRET).sub).toBe(result.user.id);
    expect(mongo.all('patients')).toHaveLength(1);
    expect(mongo.all('patients')[0].user_id).toBe(result.user.id);
    await expect(authService.getProfile(result.user.id)).resolves.toMatchObject({
      profile: { id: 'legacy-patient-id', patient_code: 'AD-2020-000001' },
    });
    expect(mongo.all('refresh_tokens')).toHaveLength(1);
  });

  it('restores a legacy patient account with a formatted mobile and missing active flag after OTP', async () => {
    const previousEnvironment = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'development';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'true';
    addRole('patient');
    const user = addUser({
      id: 'legacy-patient-user',
      email: null,
      mobile: '+91-98765-43210',
      role: 'patient',
      is_active: undefined,
    });
    mongo.insert('patients', {
      id: 'legacy-linked-profile',
      patient_code: 'AD-2021-000001',
      user_id: user.id,
      mobile: '98765 43210',
      is_active: true,
      deleted_at: null,
    });

    let result;
    try {
      const challenge = await otpService.requestOtp({
        target: '9876543210',
        purpose: 'patient_login',
      });
      result = await authService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: challenge.demo_otp,
        purpose: 'patient_login',
      }, req);
    } finally {
      if (previousEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment.nodeEnv;
      if (previousEnvironment.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = previousEnvironment.enabled;
    }

    expect(result.user).toMatchObject({ id: user.id, role: 'patient' });
    expect(mongo.all('users')[0].is_active).toBe(true);
    await expect(authService.getProfile(user.id)).resolves.toMatchObject({
      profile: { id: 'legacy-linked-profile', patient_code: 'AD-2021-000001' },
    });
    expect(mongo.all('refresh_tokens')).toHaveLength(1);
  });

  it('does not send an OTP to a patient account explicitly marked inactive', async () => {
    addUser({
      id: 'disabled-patient-user',
      role: 'patient',
      is_active: false,
    });
    mongo.insert('patients', {
      id: 'disabled-patient-profile',
      user_id: 'disabled-patient-user',
      mobile: '9876543210',
      is_active: true,
      deleted_at: null,
    });

    await expect(otpService.requestOtp({
      target: '9876543210',
      purpose: 'patient_login',
    })).rejects.toMatchObject({ status: 409, code: 'PATIENT_ACCOUNT_INACTIVE' });
    expect(mongo.all('otp_verifications')).toHaveLength(0);
  });

  it('does not misclassify an active profile linked to a soft-deleted account as unregistered', async () => {
    addUser({
      id: 'soft-deleted-patient-user',
      role: 'patient',
      is_active: false,
      deleted_at: new Date(),
    });
    mongo.insert('patients', {
      id: 'active-profile-for-deleted-user',
      user_id: 'soft-deleted-patient-user',
      mobile: '9876543210',
      is_active: true,
      deleted_at: null,
    });

    await expect(otpService.requestOtp({
      target: '9876543210',
      purpose: 'patient_login',
    })).rejects.toMatchObject({ status: 409, code: 'PATIENT_ACCOUNT_INACTIVE' });
    expect(mongo.all('otp_verifications')).toHaveLength(0);
  });

  it('lets an administrator restore the existing account before the patient completes OTP login', async () => {
    const original = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'development';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'true';
    addRole('patient');
    const user = addUser({
      id: 'restorable-patient-user',
      role: 'patient',
      is_active: false,
      deleted_at: new Date(),
    });
    mongo.insert('patients', {
      id: 'restorable-patient-profile',
      patient_code: 'AD-2026-000001',
      user_id: user.id,
      mobile: user.mobile,
      is_active: true,
      deleted_at: null,
    });

    try {
      await expect(otpService.requestOtp({
        target: user.mobile,
        purpose: 'patient_login',
      })).rejects.toMatchObject({ status: 409, code: 'PATIENT_ACCOUNT_INACTIVE' });

      await adminService.updateUser(user.id, { is_active: true }, {
        ...req,
        user: { sub: 'administrator-id', role: 'admin' },
      });

      const challenge = await otpService.requestOtp({
        target: user.mobile,
        purpose: 'patient_login',
      });
      const session = await authService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: challenge.demo_otp,
        purpose: 'patient_login',
      }, req);

      expect(session.user).toMatchObject({ id: user.id, role: 'patient' });
      expect(mongo.all('patients')).toHaveLength(1);
      expect(mongo.all('patients')[0]).toMatchObject({
        id: 'restorable-patient-profile',
        patient_code: 'AD-2026-000001',
        user_id: user.id,
        is_active: true,
      });
      expect(mongo.all('refresh_tokens')).toHaveLength(1);
    } finally {
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
      if (original.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = original.enabled;
    }
  });

  it('rejects OTP login when a mobile number matches multiple unlinked patient profiles', async () => {
    const previousEnvironment = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'development';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'true';
    addRole('patient');
    for (const id of ['legacy-patient-a', 'legacy-patient-b']) {
      mongo.insert('patients', {
        id,
        mobile: '9876543210',
        is_active: true,
        deleted_at: null,
      });
    }

    try {
      const challenge = await otpService.requestOtp({
        target: '9876543210',
        purpose: 'patient_login',
      });
      await expect(authService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: challenge.demo_otp,
        purpose: 'patient_login',
      }, req)).rejects.toMatchObject({ status: 409, code: 'PATIENT_PROFILE_AMBIGUOUS' });
    } finally {
      if (previousEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment.nodeEnv;
      if (previousEnvironment.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = previousEnvironment.enabled;
    }

    expect(mongo.all('users')).toHaveLength(0);
    expect(mongo.all('refresh_tokens')).toHaveLength(0);
  });

  it('does not send registration OTP for a number already stored on a patient profile', async () => {
    mongo.insert('patients', {
      id: 'existing-patient-id',
      mobile: '9876543210',
      is_active: true,
      deleted_at: null,
    });

    await expect(otpService.requestOtp({
      target: '9876543210',
      purpose: 'patient_registration',
    })).rejects.toMatchObject({ status: 409, code: 'MOBILE_ALREADY_REGISTERED' });
    expect(mongo.all('otp_verifications')).toHaveLength(0);
  });

  it('generates a random development demo OTP for patient login without sending SMS', async () => {
    const original = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'development';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'true';
    addRole('patient');
    const user = addUser({ role: 'patient', email: 'patient@demo.example.test' });
    mongo.insert('patients', {
      id: 'patient-profile-id',
      user_id: user.id,
      mobile: user.mobile,
      is_active: true,
      deleted_at: null,
    });

    let result;
    try {
      const challenge = await otpService.requestOtp({
        target: '9876543210',
        purpose: 'patient_login',
      });
      expect(challenge).toMatchObject({
        delivery_mode: 'demo',
        expires_in: 300,
      });
      expect(challenge.demo_otp).toMatch(/^\d{6}$/);
      expect(mockVerifyRequests).toHaveLength(0);
      result = await authService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: challenge.demo_otp,
        purpose: 'patient_login',
      }, req);
    } finally {
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
      if (original.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = original.enabled;
    }

    expect(result.user.role).toBe('patient');
    expect(mongo.all('refresh_tokens')).toHaveLength(1);
  });

  it('never exposes a patient login demo OTP outside development', async () => {
    const original = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'production';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'true';
    addRole('patient');
    const user = addUser({ role: 'patient', email: 'patient@demo.example.test' });
    mongo.insert('patients', {
      id: 'production-patient-profile',
      user_id: user.id,
      mobile: user.mobile,
      is_active: true,
      deleted_at: null,
    });

    try {
      const challenge = await otpService.requestOtp({
        target: '9876543210',
        purpose: 'patient_login',
      });
      expect(challenge).not.toHaveProperty('demo_otp');
      expect(challenge).not.toHaveProperty('delivery_mode');
      expect(mockVerifyRequests).toEqual(['+919876543210']);
      expect(mongo.all('otp_verifications')[0].provider).toBe('twilio_verify');
    } finally {
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
      if (original.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = original.enabled;
    }
  });

  it('supports patient password login and verified-OTP password recovery', async () => {
    addRole('patient');
    const patient = addUser({
      email: 'self-registered@example.test',
      role: 'patient',
    });
    const session = await authService.loginPatient(patient.mobile, 'RightPass1', req);
    expect(session.user).toMatchObject({ id: patient.id, role: 'patient' });
    mongo.insert('refresh_tokens', {
      id: 'patient-existing-session',
      user_id: patient.id,
      revoked_at: null,
    });

    const original = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'development';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'true';
    try {
      const challenge = await otpService.requestOtp({
        target: patient.mobile,
        purpose: 'patient_password_reset',
      });
      const verified = await otpService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: challenge.demo_otp,
        purpose: 'patient_password_reset',
      });
      await authService.resetPatientPassword({
        mobile: patient.mobile,
        verification_token: verified.verification_token,
        password: 'UpdatedPass2',
      }, req);
    } finally {
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
      if (original.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = original.enabled;
    }

    expect(await bcrypt.compare('UpdatedPass2', mongo.all('users')[0].password_hash)).toBe(true);
    expect(mongo.all('refresh_tokens').every(({ revoked_at }) => Boolean(revoked_at))).toBe(true);
    expect(mongo.all('audit_logs').some(({ action }) => action === 'auth.patient.password_reset')).toBe(true);
    await expect(authService.loginPatient(patient.mobile, 'RightPass1', req))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    await expect(authService.loginPatient(patient.mobile, 'UpdatedPass2', req))
      .resolves.toMatchObject({ user: { id: patient.id, role: 'patient' } });
  });

  it('does not store provider OTPs, rejects invalid codes, and issues a one-time registration grant', async () => {
    addRole('patient');
    const previousEnvironment = process.env.NODE_ENV;
    const previousDemoSetting = process.env.PATIENT_DEMO_OTP_ENABLED;
    process.env.NODE_ENV = 'development';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'false';
    try {
      const challenge = await otpService.requestOtp({
        target: '9876543210',
        purpose: 'patient_registration',
      });
      expect(challenge).not.toHaveProperty('development_otp');
      expect(challenge).not.toHaveProperty('delivery_mode');
      expect(challenge.resend_after).toBe(30);
      expect(mockVerifyRequests).toEqual(['+919876543210']);
      expect(mongo.all('otp_verifications')[0]).toMatchObject({
        provider: 'twilio_verify',
        otp_hash: null,
      });
      await expect(otpService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: '000000',
        purpose: 'patient_registration',
      })).rejects.toMatchObject({ status: 400, code: 'OTP_INVALID' });

      const verified = await otpService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: '123456',
        purpose: 'patient_registration',
      });
      expect(verified.verification_token).toHaveLength(43);
      expect(mongo.all('otp_grants')[0].token_hash).not.toBe(verified.verification_token);
      await expect(otpService.consumeGrant(
        verified.verification_token,
        'patient_registration',
        '9876543210',
      )).resolves.toBeUndefined();
      await expect(otpService.consumeGrant(
        verified.verification_token,
        'patient_registration',
        '9876543210',
      )).rejects.toMatchObject({ status: 400, code: 'OTP_VERIFICATION_REQUIRED' });
    } finally {
      process.env.NODE_ENV = previousEnvironment;
      if (previousDemoSetting === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = previousDemoSetting;
    }
  });

  it('returns and verifies a demo code only when explicitly enabled in development', async () => {
    const original = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'development';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'true';
    try {
      const challenge = await otpService.requestOtp({
        target: '9876543210',
        purpose: 'patient_registration',
      });
      expect(challenge).toMatchObject({
        delivery_mode: 'demo',
        expires_in: 300,
        resend_after: 30,
      });
      const demoCode = challenge.demo_otp;
      expect(demoCode).toMatch(/^\d{6}$/);
      expect(mockVerifyRequests).toHaveLength(0);
      expect(mongo.all('otp_verifications')[0]).toMatchObject({
        provider: 'demo',
        otp_hash: expect.any(String),
      });
      expect(mongo.all('otp_verifications')[0].otp_hash).not.toBe(demoCode);

      await expect(otpService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: demoCode === '000000' ? '000001' : '000000',
        purpose: 'patient_registration',
      })).rejects.toMatchObject({ status: 400, code: 'OTP_INVALID' });
      const verified = await otpService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: demoCode,
        purpose: 'patient_registration',
      });
      expect(verified.verification_token).toHaveLength(43);
    } finally {
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
      if (original.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = original.enabled;
    }
  });

  it('never returns or verifies a demo code outside development', async () => {
    const original = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'production';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'true';
    try {
      const challenge = await otpService.requestOtp({
        target: '9876543210',
        purpose: 'patient_registration',
      });
      expect(challenge).not.toHaveProperty('demo_otp');
      expect(challenge).not.toHaveProperty('delivery_mode');
      expect(mockVerifyRequests).toEqual(['+919876543210']);
      expect(mongo.all('otp_verifications')[0].provider).toBe('twilio_verify');
    } finally {
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
      if (original.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = original.enabled;
    }
  });

  it('does not send SMS for the demo-only self-registration endpoint', async () => {
    const original = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.PATIENT_DEMO_OTP_ENABLED,
    };
    process.env.NODE_ENV = 'production';
    process.env.PATIENT_DEMO_OTP_ENABLED = 'true';
    try {
      await expect(otpService.requestOtp({
        target: '9876543210',
        purpose: 'patient_registration',
        demoOnly: true,
      })).rejects.toMatchObject({ status: 503, code: 'DEMO_OTP_DISABLED' });
      expect(mockVerifyRequests).toHaveLength(0);
      expect(mongo.all('otp_verifications')).toHaveLength(0);
    } finally {
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
      if (original.enabled === undefined) delete process.env.PATIENT_DEMO_OTP_ENABLED;
      else process.env.PATIENT_DEMO_OTP_ENABLED = original.enabled;
    }
  });

  it('enforces the 30-second resend cooldown and five-minute expiry', async () => {
    const challenge = await otpService.requestOtp({
      target: '9876543210',
      purpose: 'patient_registration',
    });
    const db = await mongo.getDb();
    await db.collection('otp_verifications').updateOne(
      { id: challenge.challenge_id },
      { $set: { created_at: new Date(Date.now() - 29_000) } },
    );
    await expect(otpService.requestOtp({
      target: '9876543210',
      purpose: 'patient_registration',
    })).rejects.toMatchObject({ status: 429, code: 'OTP_RESEND_TOO_SOON' });

    await db.collection('otp_verifications').updateOne(
      { id: challenge.challenge_id },
      { $set: { created_at: new Date(Date.now() - 31_000) } },
    );
    const resent = await otpService.requestOtp({
      target: '9876543210',
      purpose: 'patient_registration',
    });
    expect(resent.resend_after).toBe(30);

    const expiredChallenge = await otpService.requestOtp({
      target: '9876543211',
      purpose: 'patient_registration',
    });
    await db.collection('otp_verifications').updateOne(
      { id: expiredChallenge.challenge_id },
      { $set: { expires_at: new Date(Date.now() - 1) } },
    );
    await expect(otpService.verifyOtp({
      challenge_id: expiredChallenge.challenge_id,
      code: '123456',
      purpose: 'patient_registration',
    })).rejects.toMatchObject({ status: 400, code: 'OTP_EXPIRED' });
  });

  it('fails before creating an OTP challenge when email delivery is not configured', async () => {
    addRole('admin');
    addUser({
      id: 'active-admin-for-email-reset',
      email: 'admin@example.test',
      role: 'admin',
    });
    mockEmailOtpAdapter.isConfigured.mockReturnValueOnce(false);

    await expect(otpService.requestOtp({
      target: 'admin@example.test',
      purpose: 'admin_password_reset',
    })).rejects.toMatchObject({ status: 503, code: 'OTP_DELIVERY_UNAVAILABLE' });

    expect(mongo.all('otp_verifications')).toHaveLength(0);
    expect(mockEmailOtpAdapter.sendEmail).not.toHaveBeenCalled();
  });

  it('consumes a challenge after five incorrect verification attempts', async () => {
    const challenge = await otpService.requestOtp({
      target: '9876543210',
      purpose: 'patient_registration',
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(otpService.verifyOtp({
        challenge_id: challenge.challenge_id,
        code: '000000',
        purpose: 'patient_registration',
      })).rejects.toMatchObject({ status: 400, code: 'OTP_INVALID' });
    }
    expect(mongo.all('otp_verifications')[0]).toMatchObject({ attempts: 5 });
    expect(mongo.all('otp_verifications')[0].consumed_at).toBeTruthy();
  });

  it('fails closed and invalidates the challenge when SMS delivery is unavailable', async () => {
    twilioVerifyAdapter.sendVerification.mockResolvedValueOnce({ delivered: false });

    await expect(otpService.requestOtp({
      target: '9876543210',
      purpose: 'patient_registration',
    })).rejects.toMatchObject({ status: 503, code: 'OTP_DELIVERY_UNAVAILABLE' });

    expect(mongo.all('otp_verifications')[0].consumed_at).toBeTruthy();
  });

  it('keeps a challenge retryable when Twilio Verify is temporarily unavailable', async () => {
    const challenge = await otpService.requestOtp({
      target: '9876543210',
      purpose: 'patient_registration',
    });
    twilioVerifyAdapter.checkVerification.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(otpService.verifyOtp({
      challenge_id: challenge.challenge_id,
      code: '123456',
      purpose: 'patient_registration',
    })).rejects.toMatchObject({ status: 503, code: 'OTP_PROVIDER_UNAVAILABLE' });
    expect(mongo.all('otp_verifications')[0].consumed_at).toBeNull();
  });

  it('marks a provider-expired verification as expired and consumes the challenge', async () => {
    const challenge = await otpService.requestOtp({
      target: '9876543210',
      purpose: 'patient_registration',
    });
    twilioVerifyAdapter.checkVerification.mockRejectedValueOnce(
      Object.assign(new Error('verification not found'), { code: 20404 }),
    );

    await expect(otpService.verifyOtp({
      challenge_id: challenge.challenge_id,
      code: '123456',
      purpose: 'patient_registration',
    })).rejects.toMatchObject({ status: 400, code: 'OTP_EXPIRED' });
    expect(mongo.all('otp_verifications')[0].consumed_at).toBeTruthy();
  });

  it('rejects password-based patient login', async () => {
    addRole('patient');
    addUser({ role: 'patient', email: 'patient@demo.example.test' });

    await expect(
      authService.login('patient@demo.example.test', 'RightPass1', req, 'doctor'),
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    await expect(
      authService.login('patient@demo.example.test', 'RightPass1', req, 'patient'),
    ).rejects.toMatchObject({ status: 403, code: 'PATIENT_OTP_REQUIRED' });
    expect(mongo.all('refresh_tokens')).toHaveLength(0);
  });

  it('clears the first-login password change requirement after the patient updates it', async () => {
    addRole('patient');
    const user = addUser({
      role: 'patient',
      email: 'patient@demo.example.test',
      must_change_password: true,
    });

    await authService.changePassword(user.id, {
      new_password: 'ChangedPass2',
      confirm: 'ChangedPass2',
    }, 'patient-session', req);

    expect(mongo.all('users')[0].must_change_password).toBe(false);
    expect(await bcrypt.compare('ChangedPass2', mongo.all('users')[0].password_hash)).toBe(true);
    expect(mongo.all('audit_logs')[0].action).toBe('auth.password.change');
  });

  it('still requires the current password for a regular password change', async () => {
    addRole('doctor');
    const user = addUser({ role: 'doctor' });

    await expect(authService.changePassword(user.id, {
      new_password: 'ChangedPass2',
      confirm: 'ChangedPass2',
    }, 'doctor-session', req)).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CURRENT_PASSWORD',
    });
  });

  it('rotates refresh tokens and revokes the token family when an old token is reused', async () => {
    addRole('doctor', ['appointments:manage']);
    const user = addUser();
    const oldToken = 'o'.repeat(64);
    mongo.insert('refresh_tokens', {
      id: 'session-one',
      family_id: 'refresh-family',
      user_id: user.id,
      token_hash: authService.hashToken(oldToken),
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    });

    const result = await authService.rotateRefreshToken(oldToken, req);
    expect(result.user).toMatchObject({ id: user.id, role: 'doctor' });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).not.toBe(oldToken);
    expect(new Date(mongo.all('refresh_tokens').find(({ id }) => id === 'session-one').revoked_at)
      .getTime()).toBeGreaterThan(0);

    await expect(authService.rotateRefreshToken(oldToken, req))
      .rejects.toMatchObject({ status: 401, code: 'REFRESH_TOKEN_REUSE' });
    expect(mongo.all('refresh_tokens').every(({ revoked_at }) => Boolean(revoked_at))).toBe(true);
  });
});
