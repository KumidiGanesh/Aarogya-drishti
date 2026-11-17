const { z } = require('zod');

const indianMobile = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');
const password = z
  .string()
  .min(8)
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/\d/, 'Password must include a digit');
const preferredLanguage = z.enum(['en', 'te', 'hi', 'or']).default('en');
const authBody = (body) => z.object({ body }).passthrough();
const otpPurpose = z.enum([
  'patient_login',
  'patient_registration',
  'patient_password_reset',
  'admin_password_reset',
]);
const otpRequestSchema = authBody(
  z.object({
    purpose: otpPurpose,
    target: z.string().trim().min(1).max(254),
  }).strict().superRefine((value, context) => {
    const valid = value.purpose === 'admin_password_reset'
      ? z.string().email().max(254).safeParse(value.target).success
      : indianMobile.safeParse(value.target).success;
    if (!valid) {
      context.addIssue({
        code: 'custom',
        path: ['target'],
        message: value.purpose === 'admin_password_reset'
          ? 'Enter a valid email address'
          : 'Enter a valid 10-digit Indian mobile number',
      });
    }
  }),
);
const otpVerifySchema = authBody(
  z.object({
    challenge_id: z.string().regex(/^[a-f0-9]{36}$/),
    code: z.string().regex(/^\d{6}$/),
    purpose: otpPurpose,
  }).strict(),
);
const patientOtpRequestSchema = authBody(
  z.object({ mobile: indianMobile }).strict(),
);
const patientOtpVerifySchema = authBody(
  z.object({
    challenge_id: z.string().regex(/^[a-f0-9]{36}$/),
    code: z.string().regex(/^\d{6}$/),
  }).strict(),
);
const publicPatientRegistrationSchema = authBody(
  z.object({
    verification_token: z.string().min(32).max(128),
    full_name: z.string().trim().min(2).max(160),
    age: z.number().int().min(1).max(120),
    date_of_birth: z.string().date().optional(),
    gender: z.enum(['female', 'male', 'non_binary', 'undisclosed']),
    mobile: indianMobile,
    email: z.string().trim().email().max(254),
    password,
    confirm_password: z.string().min(1).max(128),
    village_name: z.string().trim().min(1).max(120),
    mandal: z.string().trim().max(100).optional().default(''),
    address: z.string().trim().min(1).max(500),
    district: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    emergency_contact_number: indianMobile,
    medical_history: z.object({
      conditions: z.array(z.string().trim().min(1).max(160)).max(40).default([]),
      allergies: z.array(z.string().trim().min(1).max(160)).max(40).default([]),
      current_medications: z.array(z.string().trim().min(1).max(160)).max(40).default([]),
      tobacco_use: z.boolean().default(false),
      gutkha_use: z.boolean().default(false),
    }).default({}),
    consent: z.literal(true),
    preferred_language: preferredLanguage,
  }).strict().superRefine((value, context) => {
    if (value.password !== value.confirm_password) {
      context.addIssue({
        code: 'custom',
        path: ['confirm_password'],
        message: 'Password confirmation does not match',
      });
    }
  }),
);

const patientLoginSchema = authBody(
  z.object({
    mobile: indianMobile,
    password: z.string().min(8).max(128),
  }).strict(),
);

const patientPasswordResetSchema = authBody(
  z.object({
    mobile: indianMobile,
    verification_token: z.string().min(32).max(128),
    password,
    confirm: z.string().min(1).max(128),
  }).strict().refine((value) => value.password === value.confirm, {
    message: 'Password confirmation does not match',
    path: ['confirm'],
  }),
);

const registerSchema = authBody(
  z.object({
    full_name: z.string().trim().min(1).max(160),
    mobile: indianMobile,
    email: z.string().trim().email().max(254),
    password,
    preferred_language: preferredLanguage,
    account_type: z.literal('doctor').default('doctor'),
    registration_number: z.string().trim().min(1).max(100),
    qualification: z.string().trim().max(200).optional(),
    specialty: z.string().trim().min(1).max(160),
    facility_name: z.string().trim().min(1).max(160),
    district: z.string().trim().min(1).max(100),
  }).strict(),
);

const loginSchema = authBody(
  z.object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(128),
    login_type: z.enum(['doctor', 'admin', 'patient']),
  }).strict().superRefine((value, context) => {
    if (value.login_type === 'doctor' && !value.identifier.includes('@')) {
      context.addIssue({
        code: 'custom',
        path: ['identifier'],
        message: 'Doctors must sign in using their registered email address',
      });
    }
  }),
);

const refreshSchema = authBody(
  z.object({
    refreshToken: z.string().min(32).max(256).optional(),
  }).strict(),
);

const changePasswordSchema = authBody(
  z.object({
    current_password: z.string().min(1).max(128).optional(),
    new_password: password,
    confirm: z.string().min(1).max(128),
  }).strict().refine((value) => value.new_password === value.confirm, {
    message: 'Password confirmation does not match',
    path: ['confirm'],
  }),
);
const passwordResetSchema = authBody(
  z.object({
    email: z.string().trim().email().max(254),
    verification_token: z.string().min(32).max(128),
    password,
    confirm: z.string().min(1).max(128),
  }).strict().refine((value) => value.password === value.confirm, {
    message: 'Password confirmation does not match',
    path: ['confirm'],
  }),
);

module.exports = {
  registerSchema,
  otpRequestSchema,
  otpVerifySchema,
  patientOtpRequestSchema,
  patientOtpVerifySchema,
  publicPatientRegistrationSchema,
  patientLoginSchema,
  patientPasswordResetSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  passwordResetSchema,
  password,
};
