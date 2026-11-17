const { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');
const { getDb } = require('../db/mongo');
const twilioVerifyAdapter = require('./twilioVerifyAdapter');
const emailOtpAdapter = require('./emailOtpAdapter');
const logger = require('../utils/logger');
const { mobileLookupValues, normalizeIndianMobile } = require('./mobile');

const OTP_TTL_MS = 5 * 60 * 1000;
const GRANT_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_RESEND_DELAY_MS = 30 * 1000;

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function otpSecret() {
  const secret = process.env.OTP_HASH_SECRET
    || process.env.JWT_REFRESH_SECRET
    || process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('An OTP hashing secret is required');
  return secret;
}

function getDemoOtpCode(purpose) {
  if (
    !['patient_login', 'patient_registration', 'patient_password_reset'].includes(purpose)
    || process.env.NODE_ENV !== 'development'
    || process.env.PATIENT_DEMO_OTP_ENABLED !== 'true'
  ) {
    return null;
  }
  return String(randomInt(100000, 1000000));
}

function hashOtp(challengeId, code) {
  return createHmac('sha256', otpSecret()).update(`${challengeId}:${code}`).digest('hex');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function matchesHash(left, right) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function checkTarget(target, purpose, db) {
  const users = db.collection('users');
  if (purpose === 'admin_password_reset') {
    const user = await users.findOne({
      email: target,
      role: { $in: ['admin', 'super_admin'] },
      is_active: true,
      deleted_at: null,
    });
    if (!user || ['pending', 'rejected'].includes(user.admin_registration_status)) {
      throw httpError(404, 'ACCOUNT_RECOVERY_UNAVAILABLE', 'No active administrator account can use this recovery method');
    }
    return 'email';
  }
  const mobileValues = mobileLookupValues(target);
  const matchingUsers = await users.find({ mobile: { $in: mobileValues } }).toArray();
  const patientRecords = purpose === 'patient_login' || purpose === 'patient_registration'
    ? await db.collection('patients').find({
      mobile: { $in: mobileValues },
      deleted_at: null,
    }).toArray()
    : [];
  if (matchingUsers.length > 1) {
    throw httpError(
      409,
      'PATIENT_ACCOUNT_AMBIGUOUS',
      'This mobile number matches multiple accounts and cannot be used for patient sign-in',
    );
  }
  const user = matchingUsers[0] || null;
  const patientExists = patientRecords.some((patient) => patient.is_active !== false);
  if (purpose === 'patient_login') {
    if (user?.role === 'patient' && (user.is_active === false || user.deleted_at)) {
      throw httpError(
        409,
        'PATIENT_ACCOUNT_INACTIVE',
        'This patient account is inactive and must be reactivated by an administrator',
      );
    }
    const activeOrLegacyPatient = user?.is_active === true
      || user?.is_active === undefined
      || user?.is_active === null;
    if (user?.role === 'patient' && activeOrLegacyPatient && !user.deleted_at) {
      const linkedProfiles = await db.collection('patients').find({
        user_id: user.id,
        deleted_at: null,
      }).toArray();
      if (linkedProfiles.length > 1) {
        throw httpError(409, 'PATIENT_PROFILE_AMBIGUOUS', 'The patient account is linked to multiple profiles');
      }
      if (linkedProfiles.length === 1) {
        if (linkedProfiles[0].is_active === false) {
          throw httpError(
            409,
            'PATIENT_ACCOUNT_INACTIVE',
            'This patient account is inactive and must be reactivated by an administrator',
          );
        }
        return 'mobile';
      }
      if (patientRecords.some((patient) => (
        patient.is_active !== false
        && (!patient.user_id || patient.user_id === user.id)
      ))) return 'mobile';
      throw httpError(
        409,
        'PATIENT_PROFILE_INCOMPLETE',
        'The patient account does not have an active patient profile',
      );
    }
    if (!user && patientExists) return 'mobile';
    if (!user && patientRecords.length) {
      throw httpError(
        409,
        'PATIENT_ACCOUNT_INACTIVE',
        'This patient profile is inactive and must be reactivated by an administrator',
      );
    }
    if (user) {
      throw httpError(
        409,
        'PATIENT_ACCOUNT_UNAVAILABLE',
        'This mobile number cannot be used for patient sign-in',
      );
    }
    throw httpError(404, 'MOBILE_NOT_REGISTERED', 'No active patient account uses this mobile number');
  }
  if (purpose === 'patient_password_reset') {
    if (!user || user.role !== 'patient' || !user.is_active || user.deleted_at) {
      throw httpError(
        404,
        'PASSWORD_RESET_UNAVAILABLE',
        'No active patient account uses this mobile number',
      );
    }
    return 'mobile';
  }
  if (user || patientRecords.length) {
    throw httpError(409, 'MOBILE_ALREADY_REGISTERED', 'This mobile number is already registered');
  }
  return 'mobile';
}

async function deliverOtp(channel, target, code) {
  if (channel === 'mobile') {
    return twilioVerifyAdapter.sendVerification(`+91${target}`);
  }
  return emailOtpAdapter.sendEmail({ to: target, code });
}

async function requestOtp({ target, purpose, demoOnly = false }) {
  const db = await getDb();
  const normalizedTarget = purpose === 'admin_password_reset'
    ? target.toLowerCase()
    : normalizeIndianMobile(target) || target;
  const channel = await checkTarget(normalizedTarget, purpose, db);
  if (channel === 'email' && !emailOtpAdapter.isConfigured()) {
    throw httpError(503, 'OTP_DELIVERY_UNAVAILABLE', 'Email verification delivery is not configured');
  }
  const challenges = db.collection('otp_verifications');
  const now = new Date();
  const recent = await challenges.countDocuments({
    target: normalizedTarget,
    purpose,
    created_at: { $gte: new Date(now.getTime() - OTP_WINDOW_MS) },
  });
  if (recent >= 5) throw httpError(429, 'OTP_RATE_LIMITED', 'Too many verification codes requested');
  const recentRequest = await challenges.findOne({
    target: normalizedTarget,
    purpose,
    created_at: { $gte: new Date(now.getTime() - OTP_RESEND_DELAY_MS) },
  });
  if (recentRequest) {
    throw httpError(429, 'OTP_RESEND_TOO_SOON', 'Please wait before requesting another verification code');
  }

  const challengeId = randomBytes(18).toString('hex');
  const demoCode = channel === 'mobile' ? getDemoOtpCode(purpose) : null;
  if (demoOnly && !demoCode) {
    throw httpError(503, 'DEMO_OTP_DISABLED', 'Demo verification is available only in development');
  }
  const code = demoCode || (channel === 'mobile' ? null : String(randomInt(100000, 1000000)));
  const provider = demoCode ? 'demo' : channel === 'mobile' ? 'twilio_verify' : 'internal';
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  await challenges.updateMany(
    { target: normalizedTarget, purpose, consumed_at: null },
    { $set: { consumed_at: now } },
  );
  await challenges.insertOne({
    id: challengeId,
    target: normalizedTarget,
    purpose,
    channel,
    provider,
    otp_hash: code ? hashOtp(challengeId, code) : null,
    attempts: 0,
    created_at: now,
    expires_at: expiresAt,
    purge_at: new Date(now.getTime() + OTP_WINDOW_MS),
    consumed_at: null,
  });

  let delivery;
  try {
    delivery = provider === 'demo'
      ? { delivered: true }
      : await deliverOtp(channel, normalizedTarget, code);
  } catch (error) {
    await challenges.updateOne({ id: challengeId }, { $set: { consumed_at: new Date() } });
    logger.error('OTP message delivery failed', {
      channel,
      provider: channel === 'mobile' ? 'twilio_verify' : 'email',
      errorType: error.name,
      providerCode: typeof error.code === 'number' ? error.code : undefined,
    });
    throw httpError(502, 'OTP_DELIVERY_FAILED', 'The verification message could not be sent');
  }
  if (!delivery.delivered) {
    await challenges.updateOne({ id: challengeId }, { $set: { consumed_at: new Date() } });
    logger.warn('OTP message delivery is not configured', {
      channel,
      provider: channel === 'mobile' ? 'twilio_verify' : 'email',
    });
    throw httpError(503, 'OTP_DELIVERY_UNAVAILABLE', 'Verification message delivery is not configured');
  }
  return {
    challenge_id: challengeId,
    expires_in: OTP_TTL_MS / 1000,
    resend_after: OTP_RESEND_DELAY_MS / 1000,
    ...(demoCode ? { delivery_mode: 'demo', demo_otp: demoCode } : {}),
  };
}

async function verifyOtp({ challenge_id: challengeId, code, purpose }) {
  const db = await getDb();
  const challenges = db.collection('otp_verifications');
  const now = new Date();
  const challenge = await challenges.findOne({
    id: challengeId,
    purpose,
    consumed_at: null,
  });
  if (!challenge) throw httpError(400, 'OTP_INVALID', 'The verification code is invalid');
  if (new Date(challenge.expires_at) <= now) {
    await challenges.updateOne({ id: challenge.id, consumed_at: null }, { $set: { consumed_at: now } });
    throw httpError(400, 'OTP_EXPIRED', 'The verification code has expired');
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    throw httpError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect verification attempts');
  }

  let valid = false;
  if (challenge.provider === 'demo') {
    if (!getDemoOtpCode(challenge.purpose)) {
      throw httpError(503, 'DEMO_OTP_DISABLED', 'Demo verification is available only in development');
    }
    valid = matchesHash(hashOtp(challenge.id, code), challenge.otp_hash);
  } else if (challenge.provider === 'twilio_verify' && challenge.channel === 'mobile') {
    try {
      const result = await twilioVerifyAdapter.checkVerification(`+91${challenge.target}`, code);
      valid = result.approved;
    } catch (error) {
      logger.error('Twilio Verify OTP check failed', {
        provider: 'twilio_verify',
        errorType: error.name,
        providerCode: typeof error.code === 'number' ? error.code : undefined,
      });
      if (error.code === 20404) {
        await challenges.updateOne(
          { id: challenge.id, consumed_at: null },
          { $set: { consumed_at: now } },
        );
        throw httpError(400, 'OTP_EXPIRED', 'The verification code has expired');
      }
      throw httpError(503, 'OTP_PROVIDER_UNAVAILABLE', 'OTP verification is temporarily unavailable');
    }
  } else if (challenge.otp_hash) {
    const expected = hashOtp(challenge.id, code);
    valid = matchesHash(expected, challenge.otp_hash);
  }

  if (!valid) {
    await challenges.updateOne(
      { id: challenge.id, attempts: challenge.attempts, consumed_at: null },
      {
        $inc: { attempts: 1 },
        ...(challenge.attempts + 1 >= OTP_MAX_ATTEMPTS ? { $set: { consumed_at: now } } : {}),
      },
    );
    throw httpError(400, 'OTP_INVALID', 'The verification code is invalid');
  }

  const consumed = await challenges.updateOne(
    { id: challenge.id, consumed_at: null, expires_at: { $gt: now }, attempts: { $lt: OTP_MAX_ATTEMPTS } },
    { $set: { consumed_at: now } },
  );
  if (consumed.modifiedCount !== 1) {
    throw httpError(400, 'OTP_INVALID', 'The verification code is invalid or has already been used');
  }
  if (purpose === 'patient_login') return { target: challenge.target };

  const grantToken = randomBytes(32).toString('base64url');
  await db.collection('otp_grants').insertOne({
    id: randomBytes(18).toString('hex'),
    token_hash: hashToken(grantToken),
    target: challenge.target,
    purpose,
    created_at: now,
    expires_at: new Date(now.getTime() + GRANT_TTL_MS),
    consumed_at: null,
  });
  return { target: challenge.target, verification_token: grantToken };
}

async function consumeGrant(token, purpose, target) {
  const now = new Date();
  const result = await (await getDb()).collection('otp_grants').updateOne(
    {
      token_hash: hashToken(token),
      purpose,
      target,
      consumed_at: null,
      expires_at: { $gt: now },
    },
    { $set: { consumed_at: now } },
  );
  if (result.modifiedCount !== 1) {
    throw httpError(400, 'OTP_VERIFICATION_REQUIRED', 'Verify the contact details before continuing');
  }
}

module.exports = {
  requestOtp,
  verifyOtp,
  consumeGrant,
  OTP_TTL_MS,
  GRANT_TTL_MS,
};
