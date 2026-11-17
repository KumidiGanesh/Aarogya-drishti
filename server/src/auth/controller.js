const authService = require('./service');
const patientService = require('../patients/service');
const {
  REFRESH_COOKIE,
  REFRESH_COOKIE_OPTIONS,
} = require('./constants');

function refreshTokenFromRequest(req) {
  if (req.cookies?.[REFRESH_COOKIE]) return req.cookies[REFRESH_COOKIE];
  const rawCookies = req.get('cookie') || '';
  for (const part of rawCookies.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === REFRESH_COOKIE) {
      try {
        return decodeURIComponent(valueParts.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return req.body.refreshToken;
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, REFRESH_COOKIE_OPTIONS);
}

function clearRefreshCookie(res) {
  const options = Object.fromEntries(
    Object.entries(REFRESH_COOKIE_OPTIONS).filter(([key]) => key !== 'maxAge'),
  );
  res.clearCookie(REFRESH_COOKIE, options);
}

async function requestOtp(req, res, next) {
  try {
    const result = await authService.requestOtp(req.validated.body);
    return res.status(200).json({
      success: true,
      message: 'Verification code sent',
      data: result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function requestPatientOtp(req, res, next) {
  try {
    const result = await authService.requestOtp({
      target: req.validated.body.mobile,
      purpose: 'patient_registration',
      demoOnly: true,
    });
    return res.status(200).json({
      success: true,
      message: 'Verification code sent',
      data: result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function requestPatientLoginOtp(req, res, next) {
  try {
    const result = await authService.requestOtp({
      target: req.validated.body.mobile,
      purpose: 'patient_login',
    });
    return res.status(200).json({
      success: true,
      message: 'Verification code sent',
      data: result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function requestPatientPasswordResetOtp(req, res, next) {
  try {
    const result = await authService.requestOtp({
      target: req.validated.body.mobile,
      purpose: 'patient_password_reset',
    });
    return res.status(200).json({
      success: true,
      message: 'Verification code sent',
      data: result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const result = await authService.verifyOtp(req.validated.body, req);
    if (result.refreshToken) setRefreshCookie(res, result.refreshToken);
    return res.status(200).json({
      success: true,
      message: result.user ? 'Login successful' : 'Contact verified',
      data: result.user
        ? { user: result.user, accessToken: result.accessToken }
        : result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function verifyPatientLoginOtp(req, res, next) {
  try {
    const result = await authService.verifyOtp({
      ...req.validated.body,
      purpose: 'patient_login',
    }, req);
    setRefreshCookie(res, result.refreshToken);
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: { user: result.user, accessToken: result.accessToken },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function verifyPatientOtp(req, res, next) {
  try {
    const result = await authService.verifyOtp({
      ...req.validated.body,
      purpose: 'patient_registration',
    }, req);
    return res.status(200).json({
      success: true,
      message: 'Mobile number verified',
      data: result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function verifyPatientPasswordResetOtp(req, res, next) {
  try {
    const result = await authService.verifyOtp({
      ...req.validated.body,
      purpose: 'patient_password_reset',
    }, req);
    return res.status(200).json({
      success: true,
      message: 'Mobile number verified',
      data: result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function resetPatientPassword(req, res, next) {
  try {
    await authService.resetPatientPassword(req.validated.body, req);
    return res.status(200).json({
      success: true,
      message: 'Patient password reset successfully',
      data: {},
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function registerPatient(req, res, next) {
  try {
    const registration = await patientService.registerPublicPatient(req.validated.body, req);
    const result = await authService.createSession(registration.user, req);
    setRefreshCookie(res, result.refreshToken);
    return res.status(201).json({
      success: true,
      message: 'Patient registration successful',
      data: {
        user: result.user,
        patient: registration.patient,
        accessToken: result.accessToken,
      },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function register(req, res, next) {
  try {
    const user = await authService.register(req.validated.body, req);
    return res.status(201).json({
      success: true,
      message: user.account_status === 'pending_approval'
        ? 'Doctor account request submitted for approval'
        : 'Patient account registered successfully',
      data: { user },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(
      req.validated.body.identifier,
      req.validated.body.password,
      req,
      req.validated.body.login_type,
    );
    setRefreshCookie(res, result.refreshToken);
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: { user: result.user, accessToken: result.accessToken },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function loginPatient(req, res, next) {
  try {
    const result = await authService.loginPatient(
      req.validated.body.mobile,
      req.validated.body.password,
      req,
    );
    setRefreshCookie(res, result.refreshToken);
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: { user: result.user, accessToken: result.accessToken },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.user.sid, req);
    clearRefreshCookie(res);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
}

async function refresh(req, res, next) {
  const token = refreshTokenFromRequest(req);
  if (!token) {
    clearRefreshCookie(res);
    return res.status(401).json({
      success: false,
      message: 'Refresh token is required',
      errors: [],
      code: 'MISSING_REFRESH_TOKEN',
    });
  }
  try {
    const result = await authService.rotateRefreshToken(token, req);
    setRefreshCookie(res, result.refreshToken);
    return res.status(200).json({
      success: true,
      message: 'Session refreshed',
      data: { accessToken: result.accessToken, user: result.user },
      meta: {},
    });
  } catch (error) {
    if (error.status === 401) clearRefreshCookie(res);
    return next(error);
  }
}

async function profile(req, res, next) {
  try {
    const user = await authService.getProfile(req.user.sub);
    return res.status(200).json({
      success: true,
      message: 'Profile loaded',
      data: { user },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    await authService.changePassword(
      req.user.sub,
      req.validated.body,
      req.user.sid,
      req,
    );
    return res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      data: {},
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function resetAdminPassword(req, res, next) {
  try {
    await authService.resetAdminPassword(req.validated.body, req);
    return res.status(200).json({
      success: true,
      message: 'Administrator password reset successfully',
      data: {},
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requestOtp,
  requestPatientOtp,
  requestPatientLoginOtp,
  requestPatientPasswordResetOtp,
  verifyOtp,
  verifyPatientLoginOtp,
  verifyPatientOtp,
  verifyPatientPasswordResetOtp,
  resetPatientPassword,
  registerPatient,
  register,
  login,
  loginPatient,
  logout,
  refresh,
  profile,
  changePassword,
  resetAdminPassword,
};
