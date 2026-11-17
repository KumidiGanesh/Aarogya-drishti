const express = require('express');
const rateLimit = require('express-rate-limit');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const controller = require('./controller');
const {
  patientOtpRequestSchema,
  patientOtpVerifySchema,
  publicPatientRegistrationSchema,
  patientLoginSchema,
  patientPasswordResetSchema,
} = require('./validators');

const router = express.Router();
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

router.post('/send-otp', otpLimiter, validate(patientOtpRequestSchema), controller.requestPatientOtp);
router.post('/verify-otp', otpLimiter, validate(patientOtpVerifySchema), controller.verifyPatientOtp);
router.post('/register', otpLimiter, validate(publicPatientRegistrationSchema), controller.registerPatient);
router.post('/login', loginLimiter, validate(patientLoginSchema), controller.loginPatient);
router.post(
  '/password-reset/send-otp',
  otpLimiter,
  validate(patientOtpRequestSchema),
  controller.requestPatientPasswordResetOtp,
);
router.post(
  '/password-reset/verify-otp',
  otpLimiter,
  validate(patientOtpVerifySchema),
  controller.verifyPatientPasswordResetOtp,
);
router.post(
  '/password-reset',
  otpLimiter,
  validate(patientPasswordResetSchema),
  controller.resetPatientPassword,
);
router.get('/profile', authenticate, authorize('patient'), controller.profile);
router.post('/logout', authenticate, authorize('patient'), controller.logout);

module.exports = router;
