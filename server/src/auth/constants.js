const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES || '15m';
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_COOKIE = 'aarogya_refresh';
const REFRESH_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: process.env.NODE_ENV !== 'development',
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
});
const ROLES = Object.freeze([
  'super_admin',
  'admin',
  'doctor',
  'health_worker',
  'specialist',
  'patient',
]);
const AUTHORIZED_LOGIN_ROLES = Object.freeze(['doctor', 'admin', 'super_admin', 'patient']);
const LOGIN_ROLE_GROUPS = Object.freeze({
  patient: Object.freeze(['patient']),
  doctor: Object.freeze(['doctor']),
  admin: Object.freeze(['admin', 'super_admin']),
});

module.exports = {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_OPTIONS,
  ROLES,
  AUTHORIZED_LOGIN_ROLES,
  LOGIN_ROLE_GROUPS,
};
