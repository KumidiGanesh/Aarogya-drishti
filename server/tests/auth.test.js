process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters';

jest.mock('../src/db/mongo', () => require('./helpers/mongoMock'));

jest.mock('../src/auth/service', () => ({
  requestOtp: jest.fn(),
  verifyOtp: jest.fn(),
  createSession: jest.fn(),
  register: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  rotateRefreshToken: jest.fn(),
  getProfile: jest.fn(),
  changePassword: jest.fn(),
  resetAdminPassword: jest.fn(),
  loginPatient: jest.fn(),
  resetPatientPassword: jest.fn(),
}));
jest.mock('../src/patients/service', () => ({
  registerPublicPatient: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongo = require('./helpers/mongoMock');
const app = require('../src/app');
const authService = require('../src/auth/service');
const patientService = require('../src/patients/service');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/auth/permissions');

const user = {
  id: '2a840c79-4973-4f3e-bec4-e8588016c794',
  full_name: 'Demo Doctor',
  email: 'doctor@demo.example.test',
  mobile: '9876543210',
  role: 'doctor',
  permissions: [],
  preferred_language: 'en',
};

function accessToken(role = 'doctor') {
  const sid = `session-${role}`;
  const subject = role === 'doctor' ? user.id : `${user.id}-${role}`;
  if (!mongo.all('users').some(({ id }) => id === subject)) {
    mongo.insert('users', {
      id: subject,
      role,
      is_active: true,
      deleted_at: null,
      permissions_version: 1,
    });
  }
  if (!mongo.all('roles').some(({ name }) => name === role)) {
    mongo.insert('roles', {
      name: role,
      is_system: true,
      permissions_version: 1,
      permissions: DEFAULT_ROLE_PERMISSIONS[role] || [],
    });
  }
  if (!mongo.all('refresh_tokens').some(({ id }) => id === sid)) {
    mongo.insert('refresh_tokens', {
      id: sid,
      user_id: subject,
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
    });
  }
  return jwt.sign({ role, permissions: DEFAULT_ROLE_PERMISSIONS[role] || [], pv: 1, sid }, process.env.JWT_ACCESS_SECRET, {
    subject,
    expiresIn: '5m',
  });
}

function authenticated(method, path, role = 'doctor') {
  return request(app)
    [method](path)
    .set('Authorization', `Bearer ${accessToken(role)}`);
}

beforeEach(() => {
  mongo.reset();
  jest.clearAllMocks();
  authService.register.mockResolvedValue(user);
  authService.requestOtp.mockResolvedValue({
    challenge_id: 'a'.repeat(36),
    expires_in: 300,
    resend_after: 30,
  });
  authService.verifyOtp.mockResolvedValue({
    target: user.mobile,
    verification_token: 'v'.repeat(43),
  });
  authService.createSession.mockResolvedValue({
    user: { ...user, role: 'patient' },
    accessToken: accessToken('patient'),
    refreshToken: 'r'.repeat(64),
  });
  patientService.registerPublicPatient.mockResolvedValue({
    user: { ...user, role: 'patient' },
    patient: { id: 'patient-profile-id', patient_code: 'AD-2026-000001' },
  });
  authService.login.mockResolvedValue({
    user,
    accessToken: accessToken(),
    refreshToken: 'r'.repeat(64),
  });
  authService.loginPatient.mockResolvedValue({
    user: { ...user, role: 'patient' },
    accessToken: 'patient-access-token',
    refreshToken: 'r'.repeat(64),
  });
  authService.resetPatientPassword.mockResolvedValue(undefined);
  authService.logout.mockResolvedValue(undefined);
  authService.rotateRefreshToken.mockResolvedValue({
    user,
    accessToken: accessToken(),
    refreshToken: 'n'.repeat(64),
  });
  authService.getProfile.mockResolvedValue({ ...user, profile: null, facility: null });
  authService.changePassword.mockResolvedValue(undefined);
  authService.resetAdminPassword.mockResolvedValue(undefined);
});

describe('Phase 3 authentication endpoints', () => {
  it('disables Secure refresh cookies only for local HTTP development', () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    let developmentOptions;
    jest.isolateModules(() => {
      ({ REFRESH_COOKIE_OPTIONS: developmentOptions } = require('../src/auth/constants'));
    });
    process.env.NODE_ENV = previousEnvironment;

    expect(developmentOptions).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
    });
  });

  it('rejects public patient registration and client-selected privileged roles', async () => {
    const patient = await request(app).post('/api/auth/register').send({
      full_name: 'Demo Patient',
      mobile: '9876543210',
      password: 'SafePass1',
      account_type: 'patient',
    });
    const admin = await request(app).post('/api/auth/register').send({
      full_name: 'Demo Admin',
      mobile: '9876543211',
      password: 'SafePass1',
      account_type: 'admin',
    });

    expect(patient.status).toBe(400);
    expect(admin.status).toBe(400);
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('accepts a complete doctor registration request without email verification', async () => {
    const adminRequest = await request(app).post('/api/auth/register').send({
      full_name: 'Synthetic Admin',
      mobile: '9876543210',
      password: 'StrongPass1',
      account_type: 'admin',
    });
    expect(adminRequest.status).toBe(400);

    const response = await request(app).post('/api/auth/register').send({
      full_name: 'Synthetic Doctor',
      mobile: '9876543210',
      password: 'StrongPass1',
      account_type: 'doctor',
      registration_number: 'DEMO-REG-123',
      email: 'doctor@example.test',
      specialty: 'Oral health',
      facility_name: 'Demo PHC',
      district: 'Demo district',
    });

    expect(response.status).toBe(201);
    expect(authService.register.mock.calls.at(-1)[0]).toMatchObject({
      account_type: 'doctor',
      registration_number: 'DEMO-REG-123',
    });
    expect(authService.register.mock.calls.at(-1)[0]).not.toHaveProperty('email_verification_token');
  });

  it('requests a generic OTP without exposing the verification code', async () => {
    const response = await request(app).post('/api/auth/otp/request').send({
      target: user.mobile,
      purpose: 'patient_login',
    });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Verification code sent');
    expect(response.body.data).not.toHaveProperty('development_otp');
    expect(response.body.data).not.toHaveProperty('delivery_mode');
    expect(authService.requestOtp).toHaveBeenCalledWith({
      target: user.mobile,
      purpose: 'patient_login',
    });
  });

  it('returns a clear localized message when OTP delivery is not configured', async () => {
    authService.requestOtp.mockRejectedValueOnce(Object.assign(
      new Error('Verification message delivery is not configured'),
      { status: 503, code: 'OTP_DELIVERY_UNAVAILABLE' },
    ));

    const response = await request(app).post('/api/auth/otp/request').send({
      target: 'admin@example.test',
      purpose: 'admin_password_reset',
    });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'OTP_DELIVERY_UNAVAILABLE',
      message: 'Verification code delivery is unavailable. Configure the required email or SMS provider before requesting a code.',
    });
  });

  it('uses fixed-purpose patient login OTP endpoints and issues a refresh cookie', async () => {
    const sent = await request(app).post('/api/auth/send-otp').send({
      mobile: user.mobile,
    });
    expect(sent.status).toBe(200);
    expect(authService.requestOtp).toHaveBeenCalledWith({
      target: user.mobile,
      purpose: 'patient_login',
    });

    authService.verifyOtp.mockResolvedValueOnce({
      user: { ...user, role: 'patient' },
      accessToken: 'patient-access-token',
      refreshToken: 'r'.repeat(64),
    });
    const verified = await request(app).post('/api/auth/verify-otp').send({
      challenge_id: 'a'.repeat(36),
      code: '123456',
    });

    expect(verified.status).toBe(200);
    expect(verified.body.data).toMatchObject({
      accessToken: 'patient-access-token',
      user: { role: 'patient' },
    });
    expect(verified.body.data).not.toHaveProperty('refreshToken');
    expect(verified.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(authService.verifyOtp).toHaveBeenCalledWith(
      {
        challenge_id: 'a'.repeat(36),
        code: '123456',
        purpose: 'patient_login',
      },
      expect.objectContaining({ validated: expect.any(Object) }),
    );
  });

  it('uses fixed-purpose patient OTP endpoints with validated mobile input', async () => {
    const sent = await request(app).post('/api/auth/patient/send-otp').send({
      mobile: user.mobile,
    });
    expect(sent.status).toBe(200);
    expect(sent.body.data).not.toHaveProperty('development_otp');
    expect(authService.requestOtp).toHaveBeenCalledWith({
      target: user.mobile,
      purpose: 'patient_registration',
      demoOnly: true,
    });

    const verified = await request(app).post('/api/auth/patient/verify-otp').send({
      challenge_id: 'a'.repeat(36),
      code: '123456',
    });
    expect(verified.status).toBe(200);
    expect(authService.verifyOtp).toHaveBeenCalledWith(
      {
        challenge_id: 'a'.repeat(36),
        code: '123456',
        purpose: 'patient_registration',
      },
      expect.objectContaining({ validated: expect.any(Object) }),
    );

    const invalid = await request(app).post('/api/auth/patient/send-otp').send({
      mobile: '12345',
    });
    expect(invalid.status).toBe(400);
    expect(authService.requestOtp).toHaveBeenCalledTimes(1);
  });

  it('serves the patient demo-OTP registration and password-login routes', async () => {
    authService.requestOtp.mockResolvedValueOnce({
      challenge_id: 'a'.repeat(36),
      expires_in: 300,
      resend_after: 30,
      delivery_mode: 'demo',
      demo_otp: '654321',
    });

    const sent = await request(app).post('/api/patient/send-otp').send({
      mobile: user.mobile,
    });
    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({ delivery_mode: 'demo', demo_otp: '654321' });
    expect(authService.requestOtp).toHaveBeenCalledWith({
      target: user.mobile,
      purpose: 'patient_registration',
      demoOnly: true,
    });

    authService.verifyOtp.mockResolvedValueOnce({
      target: user.mobile,
      verification_token: 'v'.repeat(43),
    });
    const verified = await request(app).post('/api/patient/verify-otp').send({
      challenge_id: 'a'.repeat(36),
      code: '123456',
    });
    expect(verified.status).toBe(200);
    expect(authService.verifyOtp).toHaveBeenCalledWith(
      {
        challenge_id: 'a'.repeat(36),
        code: '123456',
        purpose: 'patient_registration',
      },
      expect.objectContaining({ validated: expect.any(Object) }),
    );

    const login = await request(app).post('/api/patient/login').send({
      mobile: user.mobile,
      password: 'StrongPass1',
    });
    expect(login.status).toBe(200);
    expect(login.body.data).toMatchObject({
      user: { role: 'patient' },
      accessToken: 'patient-access-token',
    });
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(authService.loginPatient).toHaveBeenCalledWith(
      user.mobile,
      'StrongPass1',
      expect.objectContaining({ validated: expect.any(Object) }),
    );

    await request(app).post('/api/patient/password-reset/send-otp').send({
      mobile: user.mobile,
    });
    expect(authService.requestOtp).toHaveBeenLastCalledWith({
      target: user.mobile,
      purpose: 'patient_password_reset',
    });
    await request(app).post('/api/patient/password-reset/verify-otp').send({
      challenge_id: 'a'.repeat(36),
      code: '123456',
    });
    expect(authService.verifyOtp).toHaveBeenLastCalledWith(
      {
        challenge_id: 'a'.repeat(36),
        code: '123456',
        purpose: 'patient_password_reset',
      },
      expect.objectContaining({ validated: expect.any(Object) }),
    );
    const reset = await request(app).post('/api/patient/password-reset').send({
      mobile: user.mobile,
      verification_token: 'v'.repeat(43),
      password: 'UpdatedPass2',
      confirm: 'UpdatedPass2',
    });
    expect(reset.status).toBe(200);
    expect(authService.resetPatientPassword).toHaveBeenCalledWith(
      expect.objectContaining({ mobile: user.mobile, password: 'UpdatedPass2' }),
      expect.objectContaining({ validated: expect.any(Object) }),
    );
  });

  it('resets admin passwords only through validated verified-email recovery input', async () => {
      const invalid = await request(app).post('/api/auth/password-reset').send({
        email: 'admin@example.test',
        password: 'StrongPass1',
        confirm: 'Different2',
        verification_token: 'v'.repeat(43),
      });
      expect(invalid.status).toBe(400);

      const response = await request(app).post('/api/auth/password-reset').send({
        email: 'admin@example.test',
        password: 'StrongPass1',
        confirm: 'StrongPass1',
        verification_token: 'v'.repeat(43),
      });
      expect(response.status).toBe(200);
      expect(authService.resetAdminPassword).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'admin@example.test' }),
        expect.objectContaining({ validated: expect.any(Object) }),
      );
    });

  it('verifies a patient OTP and sets the HTTP-only refresh cookie', async () => {
      authService.verifyOtp.mockResolvedValueOnce({
        user: { ...user, role: 'patient' },
        accessToken: 'access-token',
        refreshToken: 'r'.repeat(64),
      });
      const response = await request(app).post('/api/auth/otp/verify').send({
        challenge_id: 'a'.repeat(36),
        code: '123456',
        purpose: 'patient_login',
      });

      expect(response.status).toBe(200);
      expect(response.body.data.accessToken).toBe('access-token');
      expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    });

  it('creates a patient account only through verified OTP registration', async () => {
      const response = await request(app).post('/api/patient/register').send({
        verification_token: 'v'.repeat(43),
        full_name: 'Demo Patient',
        age: 30,
        gender: 'female',
        mobile: user.mobile,
        email: 'demo.patient@example.test',
        password: 'StrongPass1',
        confirm_password: 'StrongPass1',
        village_name: 'Demo Village',
        mandal: 'Demo Mandal',
        address: 'Demo address',
        district: 'Demo district',
        state: 'Andhra Pradesh',
        emergency_contact_number: '9876543211',
        medical_history: { tobacco_use: true, gutkha_use: true },
        consent: true,
        preferred_language: 'en',
      });

      expect(response.status).toBe(201);
      expect(patientService.registerPublicPatient).toHaveBeenCalledWith(
        expect.objectContaining({
          mandal: 'Demo Mandal',
          medical_history: expect.objectContaining({ tobacco_use: true, gutkha_use: true }),
        }),
        expect.any(Object),
      );
      expect(authService.createSession).toHaveBeenCalled();
      expect(response.body.data.user.role).toBe('patient');
  });

  it('rejects invalid registration and login bodies', async () => {
    const registration = await request(app).post('/api/auth/register').send({
      full_name: 'Demo',
      mobile: '123',
      password: 'weak',
    });
    const login = await request(app).post('/api/auth/login').send({ identifier: 'x' });

    expect(registration.status).toBe(400);
    expect(login.status).toBe(400);
    expect(registration.body.code).toBe('VALIDATION_ERROR');
    expect(login.body.code).toBe('VALIDATION_ERROR');
  });

  it('validates login categories and prevents password-based patient login', async () => {
    const invalid = await request(app).post('/api/auth/login').send({
      identifier: user.mobile,
      password: 'SafePass1',
      login_type: 'health_worker',
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
    expect(authService.login).not.toHaveBeenCalled();

    authService.login.mockRejectedValueOnce(Object.assign(
      new Error('Patients must sign in using a mobile verification code'),
      { status: 403, code: 'PATIENT_OTP_REQUIRED' },
    ));
    const patientLogin = await request(app).post('/api/auth/login').send({
      identifier: user.mobile,
      password: 'SafePass1',
      login_type: 'patient',
    }).expect(403);
    expect(patientLogin.body.code).toBe('PATIENT_OTP_REQUIRED');
    expect(authService.login).toHaveBeenCalledWith(
      user.mobile,
      'SafePass1',
      expect.objectContaining({ validated: expect.any(Object) }),
      'patient',
    );

    await request(app).post('/api/auth/login').send({
      identifier: user.email,
      password: 'SafePass1',
      login_type: 'doctor',
    }).expect(200);
    expect(authService.login).toHaveBeenCalledWith(
      user.email,
      'SafePass1',
      expect.objectContaining({ validated: expect.any(Object) }),
      'doctor',
    );
  });

  it('logs in and issues a secure httpOnly refresh cookie without exposing it in JSON', async () => {
    const response = await request(app).post('/api/auth/login').send({
      identifier: user.email,
      password: 'SafePass1',
      login_type: 'doctor',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data).not.toHaveProperty('refreshToken');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('Secure');
  });

  it('rejects unauthenticated login/logout/profile/password operations appropriately', async () => {
    const logout = await request(app).post('/api/auth/logout');
    const profile = await request(app).get('/api/auth/profile');
    const me = await request(app).get('/api/auth/me');
    const changePassword = await request(app).put('/api/auth/change-password').send({});
    const refresh = await request(app).post('/api/auth/refresh-token').send({});

    expect(logout.status).toBe(401);
    expect(profile.status).toBe(401);
    expect(me.status).toBe(401);
    expect(changePassword.status).toBe(401);
    expect(refresh.status).toBe(401);
  });

  it('returns 403 for protected routes when the JWT role is not permitted', async () => {
    const logout = await authenticated('post', '/api/auth/logout', 'unexpected_role');
    const profile = await authenticated('get', '/api/auth/profile', 'unexpected_role');
    const changePassword = await authenticated(
      'put',
      '/api/auth/change-password',
      'unexpected_role',
    ).send({ current_password: 'a', new_password: 'SafePass1', confirm: 'SafePass1' });

    expect(logout.status).toBe(403);
    expect(profile.status).toBe(403);
    expect(changePassword.status).toBe(403);
  });

  it('allows active patient sessions to access protected patient APIs', async () => {
    const response = await authenticated('get', '/api/auth/profile', 'patient');
    expect(response.status).toBe(200);
  });

  it('exposes the authenticated account through the /me alias', async () => {
    authService.getProfile.mockResolvedValueOnce({ ...user, role: 'patient' });
    const response = await authenticated('get', '/api/auth/me', 'patient');
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ role: 'patient' });
  });

  it('blocks API access until a patient changes the temporary password', async () => {
    const token = accessToken('patient');
    const patient = mongo.all('users').find(({ role }) => role === 'patient');
    const db = await mongo.getDb();
    await db.collection('users').updateOne(
      { id: patient.id },
      { $set: { must_change_password: true } },
    );

    const profile = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);
    const changed = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        new_password: 'ChangedPass2',
        confirm: 'ChangedPass2',
      });

    expect(profile.status).toBe(403);
    expect(profile.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(changed.status).toBe(200);
  });

  it('rotates a refresh token and returns profile and password-change data', async () => {
    const refresh = await request(app)
      .post('/api/auth/refresh-token')
      .send({
        refreshToken: 'r'.repeat(64),
      });
    const profile = await authenticated('get', '/api/auth/profile');
    const changePassword = await authenticated('put', '/api/auth/change-password').send({
      current_password: 'OldPass1',
      new_password: 'NewPass2',
      confirm: 'NewPass2',
    });
    const logout = await authenticated('post', '/api/auth/logout');

    expect(refresh.status).toBe(200);
    expect(refresh.body.data.accessToken).toBeTruthy();
    expect(profile.body.data.user.profile).toBeNull();
    expect(changePassword.status).toBe(200);
    expect(logout.status).toBe(204);
  });

  it('rejects invalid password confirmation', async () => {
    const response = await authenticated('put', '/api/auth/change-password').send({
      current_password: 'OldPass1',
      new_password: 'NewPass2',
      confirm: 'Different3',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});
