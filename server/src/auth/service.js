const bcrypt = require('bcrypt');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/mongo');
const otpService = require('./otpService');
const { mobileLookupValues, normalizeIndianMobile } = require('./mobile');
const {
  ACCESS_TOKEN_TTL,
  AUTHORIZED_LOGIN_ROLES,
  REFRESH_TOKEN_TTL_SECONDS,
  LOGIN_ROLE_GROUPS,
} = require('./constants');

const GENERIC_CREDENTIALS_MESSAGE = 'Invalid credentials';
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-account-timing-protection', 12);

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function createRefreshToken() {
  return randomBytes(48).toString('base64url');
}

function issueAccessToken(user, refreshSessionId, permissions) {
  if (!process.env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET is required');
  return jwt.sign(
    { role: user.role, pv: Number(user.permissions_version), sid: refreshSessionId, permissions },
    process.env.JWT_ACCESS_SECRET,
    { subject: user.id, expiresIn: ACCESS_TOKEN_TTL, issuer: 'aarogya-drishti' },
  );
}

async function getRolePermissions(role) {
  const db = await getDb();
  const roleRecord = await db.collection('roles').findOne({ name: role, is_system: true });
  if (!roleRecord) return null;
  return {
    role: roleRecord.name,
    permissions_version: roleRecord.permissions_version || 1,
    permissions: roleRecord.permissions || [],
  };
}

async function writeAudit(db, req, { userId, action, entity = 'auth', metadata = {} }) {
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: userId || null,
    action,
    entity,
    entity_id: userId || null,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata,
    created_at: new Date(),
  });
}

function safeUser(user, role, permissions = []) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    username: user.username || null,
    mobile: user.mobile,
    role,
    permissions,
    preferred_language: user.preferred_language,
    must_change_password: Boolean(user.must_change_password),
  };
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function register(input, req) {
  const db = await getDb();
  const email = input.email.toLowerCase();
  const existing = await db.collection('users').findOne({
    $or: [{ email }, { mobile: input.mobile }],
    deleted_at: null,
  });
  if (existing) {
    throw httpError(409, existing.email === email ? 'EMAIL_ALREADY_REGISTERED' : 'ACCOUNT_EXISTS',
      'An account with this email or mobile number already exists');
  }
  const roleData = await getRolePermissions('doctor');
  if (!roleData) {
    throw httpError(503, 'REGISTRATION_UNAVAILABLE', 'Account registration is temporarily unavailable');
  }
  const id = randomUUID();
  const user = {
    id,
    full_name: input.full_name,
    email,
    mobile: input.mobile,
    password_hash: await bcrypt.hash(input.password, 12),
    preferred_language: input.preferred_language,
    role: 'doctor',
    email_verified_at: null,
    is_active: false,
    doctor_request_status: 'pending',
    deleted_at: null,
    failed_login_count: 0,
    permissions_version: roleData.permissions_version,
    created_at: new Date(),
  };
  try {
    await db.collection('users').insertOne(user);
    await db.collection('doctors').insertOne({
      id: randomUUID(),
      user_id: id,
      registration_number: input.registration_number,
      qualification: input.qualification || '',
      specialty: input.specialty,
      facility_name: input.facility_name,
      district: input.district,
      created_at: new Date(),
    });
    await writeAudit(db, req, {
      userId: id,
      action: 'auth.doctor.registration_requested',
      metadata: { role: 'doctor', active: false },
    });
    return {
      ...safeUser(user, 'doctor'),
      pending_approval: true,
      account_status: 'pending_approval',
      doctor_request_status: 'pending',
    };
  } catch (error) {
    await Promise.all([
      db.collection('users').deleteMany({ id }),
      db.collection('doctors').deleteMany({ user_id: id }),
    ]);
    if (error.code === 11000) {
      throw httpError(409, 'ACCOUNT_EXISTS', 'An account with this mobile number or email already exists');
    }
    throw error;
  }
}

async function login(identifier, password, req, loginType) {
  if (loginType === 'patient') {
    throw httpError(403, 'PATIENT_OTP_REQUIRED', 'Patients must sign in using a mobile verification code');
  }
  return loginWithPassword(identifier, password, req, loginType);
}

async function loginPatient(mobile, password, req) {
  return loginWithPassword(mobile, password, req, 'patient');
}

async function loginWithPassword(identifier, password, req, loginType) {
  const db = await getDb();
  const normalized = identifier.includes('@') || loginType === 'admin'
    ? identifier.toLowerCase()
    : identifier;
  const identifierType = identifier.includes('@')
    ? 'email'
    : /^[6-9]\d{9}$/.test(identifier) ? 'mobile' : 'username';
  const identityFields = [{ mobile: normalized }, { email: normalized }];
  if (loginType === 'admin') identityFields.push({ username: normalized });
  const user = await db.collection('users').findOne({
    $or: identityFields,
    deleted_at: null,
  });
  const passwordMatches = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
  const locked = user?.locked_until && new Date(user.locked_until) > new Date();
  const active = user?.is_active && !user?.deleted_at;
  if (!user || !passwordMatches || locked) {
    if (user && active && !locked && !passwordMatches) {
      const failedCount = Number(user.failed_login_count || 0) + 1;
      await db.collection('users').updateOne(
        { id: user.id, failed_login_count: user.failed_login_count || 0 },
        {
          $set: {
            failed_login_count: failedCount,
            locked_until: failedCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : user.locked_until || null,
          },
        },
      );
    }
    await writeAudit(db, req, {
      userId: user?.id,
      action: 'auth.login.failure',
      metadata: { identifier_type: identifierType },
    });
    if (!user && loginType === 'doctor') {
      throw httpError(404, 'DOCTOR_ACCOUNT_NOT_FOUND', 'No doctor account or registration request was found');
    }
    throw httpError(401, 'INVALID_CREDENTIALS', GENERIC_CREDENTIALS_MESSAGE);
  }

  const roleData = await getRolePermissions(user.role);
  if (
    !roleData ||
    !AUTHORIZED_LOGIN_ROLES.includes(roleData.role) ||
    (loginType && !LOGIN_ROLE_GROUPS[loginType]?.includes(roleData.role))
  ) {
    await writeAudit(db, req, {
      userId: user.id,
      action: 'auth.login.failure',
      metadata: {
        identifier_type: identifierType,
        login_type: loginType,
      },
    });
    throw httpError(401, 'INVALID_CREDENTIALS', GENERIC_CREDENTIALS_MESSAGE);
  }
  if (user.role === 'doctor' && loginType === 'doctor') {
    let requestStatus = user.doctor_request_status;
    if (!requestStatus && !active) {
      const history = await db.collection('audit_logs').find({ user_id: user.id }).toArray();
      if (history.some((entry) => entry.action === 'admin.doctor.registration_rejected')) {
        requestStatus = 'rejected';
      } else if (
        history.some((entry) => entry.action === 'auth.doctor.registration_requested')
        && !history.some((entry) => (
          ['admin.doctor.registration_approved', 'admin.doctor.registration_rejected'].includes(entry.action)
        ))
      ) {
        requestStatus = 'pending';
      }
    }
    if (requestStatus === 'pending') {
      await writeAudit(db, req, {
        userId: user.id,
        action: 'auth.login.failure',
        metadata: { reason: 'doctor_approval_pending' },
      });
      throw httpError(403, 'DOCTOR_APPROVAL_PENDING', 'Doctor registration is awaiting administrator approval');
    }
    if (requestStatus === 'rejected') {
      await writeAudit(db, req, {
        userId: user.id,
        action: 'auth.login.failure',
        metadata: { reason: 'doctor_registration_rejected' },
      });
      throw httpError(403, 'DOCTOR_REGISTRATION_REJECTED', 'Doctor registration was rejected; contact an administrator');
    }
  }
  if (['admin', 'super_admin'].includes(user.role) && loginType === 'admin') {
    if (user.admin_registration_status === 'pending') {
      await writeAudit(db, req, {
        userId: user.id,
        action: 'auth.login.failure',
        metadata: { reason: 'admin_approval_pending' },
      });
      throw httpError(403, 'ADMIN_APPROVAL_PENDING', 'Administrator account is awaiting Super Admin approval');
    }
    if (user.admin_registration_status === 'rejected') {
      await writeAudit(db, req, {
        userId: user.id,
        action: 'auth.login.failure',
        metadata: { reason: 'admin_registration_rejected' },
      });
      throw httpError(403, 'ADMIN_REGISTRATION_REJECTED', 'Administrator account registration was rejected');
    }
  }
  if (!active) {
    await writeAudit(db, req, {
      userId: user.id,
      action: 'auth.login.failure',
      metadata: { identifier_type: identifierType },
    });
    throw httpError(401, 'INVALID_CREDENTIALS', GENERIC_CREDENTIALS_MESSAGE);
  }

  return createSession(user, req, roleData);
}

async function createSession(user, req, suppliedRoleData) {
  const db = await getDb();
  const roleData = suppliedRoleData || await getRolePermissions(user.role);
  if (
    !user.is_active
    || user.deleted_at
    || !roleData
    || !AUTHORIZED_LOGIN_ROLES.includes(roleData.role)
  ) {
    throw httpError(401, 'INVALID_CREDENTIALS', GENERIC_CREDENTIALS_MESSAGE);
  }
  const sessionId = randomUUID();
  const refreshToken = createRefreshToken();
  const familyId = randomUUID();
  await db.collection('refresh_tokens').insertOne({
    id: sessionId,
    family_id: familyId,
    user_id: user.id,
    token_hash: hashToken(refreshToken),
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    revoked_at: null,
    created_at: new Date(),
  });
  await db.collection('users').updateOne(
    { id: user.id },
    { $set: { failed_login_count: 0, locked_until: null, last_login_at: new Date() } },
  );
  await writeAudit(db, req, {
    userId: user.id,
    action: 'auth.login.success',
    metadata: { role: roleData.role },
  });
  return {
    user: safeUser(user, roleData.role, roleData.permissions),
    accessToken: issueAccessToken(
      { ...user, role: roleData.role, permissions_version: roleData.permissions_version },
      sessionId,
      roleData.permissions,
    ),
    refreshToken,
  };
}

async function patientUserForOtpLogin(db, mobile, req) {
  const users = db.collection('users');
  const patients = db.collection('patients');
  const mobileValues = mobileLookupValues(mobile);
  const matchingUsers = await users.find({ mobile: { $in: mobileValues } }).toArray();
  if (matchingUsers.length > 1) {
    throw httpError(409, 'PATIENT_ACCOUNT_AMBIGUOUS', 'This mobile number matches multiple accounts');
  }
  let user = matchingUsers[0] || null;
  if (user?.role === 'patient' && (user.is_active === false || user.deleted_at)) {
    throw httpError(
      409,
      'PATIENT_ACCOUNT_INACTIVE',
      'This patient account is inactive and must be reactivated by an administrator',
    );
  }
  if (user && (
    user.role !== 'patient'
    || (
      user.is_active !== true
      && user.is_active !== undefined
      && user.is_active !== null
    )
    || user.deleted_at
  )) {
    throw httpError(409, 'PATIENT_ACCOUNT_UNAVAILABLE', 'This mobile number cannot be used for patient sign-in');
  }

  async function activateLegacyAccount(account) {
    if (account.is_active === true) return account;
    const updated = await users.updateOne(
      { id: account.id, is_active: account.is_active ?? null, deleted_at: null },
      { $set: { is_active: true, updated_at: new Date() } },
    );
    if (updated.matchedCount === 1) return { ...account, is_active: true };
    const current = await users.findOne({ id: account.id });
    if (
      !current
      || current.role !== 'patient'
      || (
        current.is_active !== true
        && current.is_active !== undefined
        && current.is_active !== null
      )
      || current.deleted_at
    ) {
      throw httpError(409, 'PATIENT_ACCOUNT_UNAVAILABLE', 'This mobile number cannot be used for patient sign-in');
    }
    return current;
  }

  if (user) {
    const linkedRecords = await patients.find({
      user_id: user.id,
      deleted_at: null,
    }).toArray();
    const linkedProfiles = linkedRecords.filter((patient) => patient.is_active !== false);
    if (linkedProfiles.length > 1) {
      throw httpError(409, 'PATIENT_PROFILE_AMBIGUOUS', 'The patient account is linked to multiple profiles');
    }
    if (linkedProfiles.length === 1) return activateLegacyAccount(user);
    if (linkedRecords.length) {
      throw httpError(
        409,
        'PATIENT_ACCOUNT_INACTIVE',
        'This patient profile is inactive and must be reactivated by an administrator',
      );
    }
  }

  const allMatchingProfiles = await patients.find({
    mobile: { $in: mobileValues },
    deleted_at: null,
  }).toArray();
  const matchingProfiles = allMatchingProfiles.filter((patient) => patient.is_active !== false);
  if (matchingProfiles.length > 1) {
    throw httpError(409, 'PATIENT_PROFILE_AMBIGUOUS', 'This mobile number is linked to multiple patient profiles');
  }
  if (!matchingProfiles.length) {
    if (allMatchingProfiles.length) {
      throw httpError(
        409,
        'PATIENT_ACCOUNT_INACTIVE',
        'This patient profile is inactive and must be reactivated by an administrator',
      );
    }
    throw httpError(
      user ? 409 : 404,
      user ? 'PATIENT_PROFILE_INCOMPLETE' : 'MOBILE_NOT_REGISTERED',
      user ? 'The patient account does not have an active patient profile' : 'No active patient profile uses this mobile number',
    );
  }

  const patient = matchingProfiles[0];
  if (patient.user_id && patient.user_id !== user?.id) {
    throw httpError(409, 'PATIENT_ACCOUNT_UNAVAILABLE', 'This patient profile is linked to another account');
  }

  let createdUser = false;
  if (!user) {
    const roleData = await getRolePermissions('patient');
    if (!roleData) throw httpError(503, 'PATIENT_ACCOUNT_UNAVAILABLE', 'Patient accounts are not configured');
    user = {
      id: randomUUID(),
      full_name: patient.full_name || 'Patient',
      email: null,
      mobile: normalizeIndianMobile(mobile) || mobile,
      password_hash: await bcrypt.hash(randomBytes(32).toString('base64url'), 12),
      preferred_language: patient.preferred_language || 'en',
      role: 'patient',
      is_active: true,
      deleted_at: null,
      failed_login_count: 0,
      locked_until: null,
      must_change_password: false,
      permissions_version: roleData.permissions_version || 1,
      created_at: new Date(),
      updated_at: new Date(),
    };
    try {
      await users.insertOne(user);
      createdUser = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
      const currentUsers = await users.find({ mobile: { $in: mobileValues } }).toArray();
      if (currentUsers.length > 1) {
        throw httpError(409, 'PATIENT_ACCOUNT_AMBIGUOUS', 'This mobile number matches multiple accounts');
      }
      if (!currentUsers.length) {
        throw httpError(409, 'PATIENT_ACCOUNT_UNAVAILABLE', 'This mobile number cannot be used for patient sign-in');
      }
      user = currentUsers[0];
      if (
        user.role !== 'patient'
        || (
          user.is_active !== true
          && user.is_active !== undefined
          && user.is_active !== null
        )
        || user.deleted_at
      ) {
        throw httpError(409, 'PATIENT_ACCOUNT_UNAVAILABLE', 'This mobile number cannot be used for patient sign-in');
      }
    }
  }

  const linkedProfile = await patients.findOne({
    user_id: user.id,
    deleted_at: null,
  });
  if (linkedProfile && linkedProfile.id !== patient.id) {
    if (createdUser) await users.deleteMany({ id: user.id });
    throw httpError(409, 'PATIENT_ACCOUNT_UNAVAILABLE', 'This account is already linked to another patient profile');
  }

  if (patient.user_id !== user.id) {
    const link = await patients.updateOne(
      { id: patient.id, mobile: patient.mobile, user_id: null, deleted_at: null },
      { $set: { user_id: user.id, is_active: true, updated_at: new Date() } },
    );
    if (link.matchedCount !== 1) {
      const current = await patients.findOne({ id: patient.id, deleted_at: null });
      if (current?.user_id !== user.id) {
        if (createdUser) await users.deleteMany({ id: user.id });
        throw httpError(409, 'PATIENT_PROFILE_LINK_CONFLICT', 'The patient profile changed during sign-in');
      }
    }
    await writeAudit(db, req, {
      userId: user.id,
      action: 'auth.patient.profile_linked',
      metadata: { patient_id: patient.id, patient_code: patient.patient_code },
    });
  }
  return activateLegacyAccount(user);
}

async function verifyOtp(input, req) {
  const verified = await otpService.verifyOtp(input);
  if (input.purpose !== 'patient_login') return verified;
  const db = await getDb();
  const user = await patientUserForOtpLogin(db, verified.target, req);
  return { ...(await createSession(user, req)) };
}

async function logout(sessionId, req) {
  const db = await getDb();
  const result = await db.collection('refresh_tokens').updateOne(
    { id: sessionId, user_id: req.user.sub, revoked_at: null },
    { $set: { revoked_at: new Date() } },
  );
  await writeAudit(db, req, {
    userId: req.user.sub,
    action: 'auth.logout',
    metadata: { session_revoked: result.modifiedCount > 0 },
  });
}

async function rotateRefreshToken(token, req) {
  const db = await getDb();
  const tokenCollection = db.collection('refresh_tokens');
  const userCollection = db.collection('users');
  const session = await tokenCollection.findOne({ token_hash: hashToken(token) });
  if (!session) throw httpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  if (session.revoked_at) {
    await tokenCollection.updateMany(
      { family_id: session.family_id, revoked_at: null },
      { $set: { revoked_at: new Date() } },
    );
    await writeAudit(db, req, {
      userId: session.user_id,
      action: 'auth.refresh.reuse_detected',
      metadata: { family_revoked: true },
    });
    throw httpError(401, 'REFRESH_TOKEN_REUSE', 'Refresh token reuse detected');
  }
  if (new Date(session.expires_at) <= new Date()) {
    await tokenCollection.updateOne({ id: session.id }, { $set: { revoked_at: new Date() } });
    await writeAudit(db, req, {
      userId: session.user_id,
      action: 'auth.refresh.failure',
      metadata: { reason: 'expired_or_inactive' },
    });
    throw httpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }

  const user = await userCollection.findOne({
    id: session.user_id,
    is_active: true,
    deleted_at: null,
  });
  if (!user) throw httpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  const roleData = await getRolePermissions(user.role);
  if (!roleData || !AUTHORIZED_LOGIN_ROLES.includes(roleData.role)) {
    await tokenCollection.updateOne({ id: session.id }, { $set: { revoked_at: new Date() } });
    await writeAudit(db, req, {
      userId: session.user_id,
      action: 'auth.refresh.failure',
      metadata: { reason: 'role_not_authorized' },
    });
    throw httpError(401, 'ROLE_NOT_AUTHORIZED', 'This account cannot access the application');
  }

  const claimed = await tokenCollection.updateOne(
    { id: session.id, revoked_at: null },
    { $set: { revoked_at: new Date() } },
  );
  if (claimed.modifiedCount !== 1) {
    await tokenCollection.updateMany(
      { family_id: session.family_id, revoked_at: null },
      { $set: { revoked_at: new Date() } },
    );
    throw httpError(401, 'REFRESH_TOKEN_REUSE', 'Refresh token reuse detected');
  }
  const nextSessionId = randomUUID();
  const nextToken = createRefreshToken();
  await tokenCollection.insertOne({
    id: nextSessionId,
    family_id: session.family_id,
    user_id: user.id,
    token_hash: hashToken(nextToken),
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    revoked_at: null,
    created_at: new Date(),
  });
  await writeAudit(db, req, { userId: user.id, action: 'auth.refresh.success' });
  return {
    accessToken: issueAccessToken(
      { id: user.id, role: roleData.role, permissions_version: roleData.permissions_version },
      nextSessionId,
      roleData.permissions,
    ),
    refreshToken: nextToken,
    user: await getProfile(user.id),
  };
}

async function getProfile(userId) {
  const db = await getDb();
  const user = await db.collection('users').findOne({
    id: userId,
    is_active: true,
    deleted_at: null,
  });
  if (!user) throw httpError(401, 'ACCOUNT_UNAVAILABLE', 'User account is unavailable');
  const roleData = await getRolePermissions(user.role);
  if (!roleData) throw new Error('User role configuration is missing');

  const profileTable = {
    doctor: 'doctors',
    health_worker: 'health_workers',
    specialist: 'specialists',
    patient: 'patients',
  }[user.role];
  const profile = profileTable
    ? await db.collection(profileTable).findOne({ user_id: userId, ...(user.role === 'patient' ? { deleted_at: null, is_active: true } : {}) })
    : null;
  const facilityId = profile?.hospital_id || profile?.phc_id || profile?.village_id;
  let facility = null;
  if (facilityId) {
    const facilityType = profile.hospital_id ? 'hospital' : profile.phc_id ? 'phc' : 'village';
    const facilityRecord = await db.collection(facilityType === 'hospital' ? 'hospitals' : `${facilityType}s`)
      .findOne({ id: facilityId });
    if (facilityRecord) facility = { type: facilityType, id: facilityRecord.id, name: facilityRecord.name };
  }
  const publicProfile = profile && Object.fromEntries(
    Object.entries(profile).filter(([key]) => !['_id', 'user_id', 'created_at', 'updated_at'].includes(key)),
  );
  return {
    ...safeUser(user, roleData.role, roleData.permissions),
    profile: publicProfile,
    facility,
  };
}

async function resetAdminPassword(input, req) {
  const db = await getDb();
  const email = input.email.toLowerCase();
  const users = db.collection('users');
  const user = await users.findOne({
    email,
    role: { $in: ['admin', 'super_admin'] },
    is_active: true,
    deleted_at: null,
  });
  if (!user || ['pending', 'rejected'].includes(user.admin_registration_status)) {
    throw httpError(404, 'ACCOUNT_RECOVERY_UNAVAILABLE', 'No active administrator account can use this recovery method');
  }
  await otpService.consumeGrant(input.verification_token, 'admin_password_reset', email);
  const passwordHash = await bcrypt.hash(input.password, 12);
  const now = new Date();
  const updated = await users.updateOne(
    { id: user.id, is_active: true, deleted_at: null },
    {
      $set: {
        password_hash: passwordHash,
        must_change_password: false,
        failed_login_count: 0,
        locked_until: null,
        updated_at: now,
      },
    },
  );
  if (updated.modifiedCount !== 1) {
    throw httpError(409, 'ACCOUNT_RECOVERY_UNAVAILABLE', 'Administrator account changed before password recovery completed');
  }
  await db.collection('refresh_tokens').updateMany(
    { user_id: user.id, revoked_at: null },
    { $set: { revoked_at: now } },
  );
  await writeAudit(db, req, {
    userId: user.id,
    action: 'auth.admin.password_reset',
    metadata: { sessions_revoked: true },
  });
}

async function resetPatientPassword(input, req) {
  const db = await getDb();
  const users = db.collection('users');
  const user = await users.findOne({
    mobile: input.mobile,
    role: 'patient',
    is_active: true,
    deleted_at: null,
  });
  if (!user) {
    throw httpError(404, 'PASSWORD_RESET_UNAVAILABLE', 'Patient password reset is unavailable');
  }
  await otpService.consumeGrant(
    input.verification_token,
    'patient_password_reset',
    input.mobile,
  );
  const now = new Date();
  const updated = await users.updateOne(
    { id: user.id, role: 'patient', is_active: true, deleted_at: null },
    {
      $set: {
        password_hash: await bcrypt.hash(input.password, 12),
        failed_login_count: 0,
        locked_until: null,
        updated_at: now,
      },
    },
  );
  if (updated.modifiedCount !== 1) {
    throw httpError(409, 'PASSWORD_RESET_UNAVAILABLE', 'Patient account changed during password reset');
  }
  await db.collection('refresh_tokens').updateMany(
    { user_id: user.id, revoked_at: null },
    { $set: { revoked_at: now } },
  );
  await writeAudit(db, req, {
    userId: user.id,
    action: 'auth.patient.password_reset',
    metadata: { sessions_revoked: true },
  });
}

async function changePassword(userId, input, sessionId, req) {
  const db = await getDb();
  const users = db.collection('users');
  const user = await users.findOne({ id: userId, is_active: true, deleted_at: null });
  if (!user || (!user.must_change_password
    && (!input.current_password || !(await bcrypt.compare(input.current_password, user.password_hash))))) {
    throw httpError(401, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
  }
  if (await bcrypt.compare(input.new_password, user.password_hash)) {
    throw httpError(422, 'PASSWORD_REUSE', 'New password must differ from the current password');
  }
  const settingCollection = db.collection('user_settings');
  const setting = await settingCollection.findOne({ user_id: userId, key: 'auth.password_history' });
  const history = setting?.value || [];
  for (const previousHash of history) {
    if (await bcrypt.compare(input.new_password, previousHash)) {
      throw httpError(422, 'PASSWORD_REUSE', 'New password cannot reuse one of the last three passwords');
    }
  }
  const nextHash = await bcrypt.hash(input.new_password, 12);
  await users.updateOne(
    { id: userId },
    { $set: { password_hash: nextHash, failed_login_count: 0, locked_until: null, must_change_password: false } },
  );
  await settingCollection.updateOne(
    { user_id: userId, key: 'auth.password_history' },
    { $set: { value: [user.password_hash, ...history].slice(0, 3), updated_at: new Date() } },
    { upsert: true },
  );
  await db.collection('refresh_tokens').updateMany(
    { user_id: userId, id: { $ne: sessionId }, revoked_at: null },
    { $set: { revoked_at: new Date() } },
  );
  await writeAudit(db, req, {
    userId,
    action: 'auth.password.change',
    metadata: { other_sessions_revoked: true },
  });
}

module.exports = {
  GENERIC_CREDENTIALS_MESSAGE,
  hashToken,
  requestOtp: otpService.requestOtp,
  register,
  login,
  loginPatient,
  verifyOtp,
  createSession,
  logout,
  rotateRefreshToken,
  getProfile,
  changePassword,
  resetAdminPassword,
  resetPatientPassword,
  issueAccessToken,
};
