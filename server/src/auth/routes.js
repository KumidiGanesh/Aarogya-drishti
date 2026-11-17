const express = require('express');
const rateLimit = require('express-rate-limit');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const controller = require('./controller');
const {
  registerSchema,
  otpRequestSchema,
  otpVerifySchema,
  patientOtpRequestSchema,
  patientOtpVerifySchema,
  publicPatientRegistrationSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  passwordResetSchema,
} = require('./validators');
const { ROLES } = require('./constants');

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again later.',
    errors: [],
    code: 'LOGIN_RATE_LIMITED',
  },
});
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many verification attempts. Please try again later.',
    errors: [],
    code: 'OTP_RATE_LIMITED',
  },
});
const authenticatedRoles = authorize(...ROLES);

router.post('/otp/request', otpLimiter, validate(otpRequestSchema), controller.requestOtp);
router.post('/otp/verify', otpLimiter, validate(otpVerifySchema), controller.verifyOtp);
router.post(
  '/send-otp',
  otpLimiter,
  validate(patientOtpRequestSchema),
  controller.requestPatientLoginOtp,
);
router.post(
  '/verify-otp',
  otpLimiter,
  validate(patientOtpVerifySchema),
  controller.verifyPatientLoginOtp,
);
router.post(
  '/patient/send-otp',
  otpLimiter,
  validate(patientOtpRequestSchema),
  controller.requestPatientOtp,
);
router.post(
  '/patient/verify-otp',
  otpLimiter,
  validate(patientOtpVerifySchema),
  controller.verifyPatientOtp,
);
router.post('/password-reset', otpLimiter, validate(passwordResetSchema), controller.resetAdminPassword);
router.post(
  '/patient/register',
  otpLimiter,
  validate(publicPatientRegistrationSchema),
  controller.registerPatient,
);
router.post('/register', validate(registerSchema), controller.register);
router.post('/login', loginLimiter, validate(loginSchema), controller.login);
router.post('/logout', authenticate, authenticatedRoles, controller.logout);
router.post('/refresh-token', validate(refreshSchema), controller.refresh);
router.get('/profile', authenticate, authenticatedRoles, controller.profile);
router.get('/me', authenticate, authenticatedRoles, controller.profile);
router.put(
  '/change-password',
  authenticate,
  authenticatedRoles,
  validate(changePasswordSchema),
  controller.changePassword,
);

module.exports = router;
