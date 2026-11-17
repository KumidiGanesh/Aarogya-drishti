const jwt = require('jsonwebtoken');
const { randomBytes } = require('node:crypto');

const publicDevelopmentDomain = 'meet.jit.si';
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const developmentEnvironments = ['development', 'test'];

function getDomain() {
  return (
    process.env.VIDEO_DOMAIN ||
    (developmentEnvironments.includes(process.env.NODE_ENV) ? publicDevelopmentDomain : '')
  );
}

function isConfigured() {
  const domain = getDomain();
  if (!domainPattern.test(domain)) return false;
  if (developmentEnvironments.includes(process.env.NODE_ENV)) return true;
  return (
    domain.toLowerCase() !== publicDevelopmentDomain &&
    Boolean(process.env.VIDEO_APP_ID) &&
    process.env.VIDEO_APP_ID !== 'aarogya-demo' &&
    Boolean(process.env.VIDEO_JWT_SECRET)
  );
}

function createRoom() {
  return `aarogya-${randomBytes(24).toString('hex')}`;
}

function createParticipantToken(
  room,
  userId,
  displayName,
  moderator = false,
  expiresInSeconds = 900,
) {
  const secret = process.env.VIDEO_JWT_SECRET;
  if (!secret) return null;
  const domain = getDomain();
  if (!domainPattern.test(domain)) return null;
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      aud: 'jitsi',
      iss: process.env.VIDEO_APP_ID || 'aarogya-development',
      sub: domain,
      room,
      context: { user: { id: userId, name: displayName }, features: { livestreaming: false } },
      moderator,
      nbf: now - 5,
    },
    secret,
    { algorithm: 'HS256', expiresIn: expiresInSeconds },
  );
}

module.exports = { createRoom, createParticipantToken, getDomain, isConfigured };
