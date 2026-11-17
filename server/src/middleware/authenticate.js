const jwt = require('jsonwebtoken');
const { getDb } = require('../db/mongo');
const localizedMessage = require('../utils/localizedMessage');
const { AUTHORIZED_LOGIN_ROLES } = require('../auth/constants');
const errorEnvelope = (res, status, message, code) =>
  res.status(status).json({
    success: false,
    message,
    errors: [],
    code,
  });

function authError(status, code, message) {
  const error = new Error(message);
  error.authResponse = true;
  error.status = status;
  error.code = code;
  return error;
}

async function authenticateToken(token, requestPath = '') {
  if (!token) throw authError(401, 'UNAUTHENTICATED', 'Authentication required');
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    if (
      typeof claims.sub !== 'string' ||
      typeof claims.role !== 'string' ||
      typeof claims.pv !== 'number' ||
      typeof claims.sid !== 'string'
    ) {
      throw authError(401, 'INVALID_TOKEN', 'Invalid access token');
    }
  } catch (error) {
    if (error.authResponse) throw error;
    throw authError(401, 'INVALID_TOKEN', 'Invalid or expired access token');
  }

  const db = await getDb();
  const [user, refreshToken, roleRecord] = await Promise.all([
    db.collection('users').findOne({ id: claims.sub }),
    db.collection('refresh_tokens').findOne({ id: claims.sid, user_id: claims.sub }),
    db.collection('roles').findOne({ name: claims.role, is_system: true }),
  ]);
  const session = user && refreshToken
    ? {
        is_active: user.is_active,
        deleted_at: user.deleted_at,
        role: user.role,
        must_change_password: Boolean(user.must_change_password),
        permissions_version: user.permissions_version || 1,
        role_permissions_version: roleRecord?.permissions_version || null,
        revoked_at: refreshToken.revoked_at,
        expires_at: refreshToken.expires_at,
      }
    : null;
  if (
    !session ||
    !session.is_active ||
    session.deleted_at ||
    session.revoked_at ||
    new Date(session.expires_at) <= new Date() ||
    session.role !== claims.role ||
    Number(session.permissions_version) !== claims.pv ||
    Number(session.role_permissions_version) !== claims.pv
  ) {
    throw authError(401, 'SESSION_REVOKED', 'Access token session is no longer active');
  }
  if (!AUTHORIZED_LOGIN_ROLES.includes(session.role)) {
    throw authError(403, 'ROLE_NOT_AUTHORIZED', 'This account cannot access the application');
  }
  if (
    session.must_change_password &&
    !['/api/auth/change-password', '/api/auth/logout'].includes(requestPath)
  ) {
    throw authError(
      403,
      'PASSWORD_CHANGE_REQUIRED',
      'Change your temporary password before continuing',
    );
  }
  return claims;
}

async function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  const token = authorization && authorization.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  try {
    req.user = await authenticateToken(token, req.originalUrl.split('?')[0]);
    return next();
  } catch (error) {
    if (!error.authResponse) return next(error);
    return errorEnvelope(
      res,
      error.status,
      localizedMessage(req, error.code, error.message),
      error.code,
    );
  }
}

authenticate.authenticateToken = authenticateToken;

module.exports = authenticate;
