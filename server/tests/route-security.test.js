process.env.JWT_ACCESS_SECRET = 'phase-twelve-route-security-test-secret-32-characters';

jest.mock('../src/db/mongo', () => require('./helpers/mongoMock'));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongo = require('./helpers/mongoMock');
const app = require('../src/app');
const openApiSpec = require('../src/openapi');

const userId = '7c31cbd1-ef65-4e8d-a526-c90dfb51192d';
const sessionId = 'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7';
const visitorToken = jwt.sign(
  { role: 'visitor', permissions: [], pv: 1, sid: sessionId },
  process.env.JWT_ACCESS_SECRET,
  { subject: userId, expiresIn: '5m' },
);

function routePath(pathname) {
  return pathname.replace(/\{[^}]+\}/g, 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce');
}

function routeRequest(method, pathname, token) {
  const call = request(app)[method](pathname);
  if (token) call.set('Authorization', `Bearer ${token}`);
  if (['post', 'put', 'patch'].includes(method)) call.send({});
  return call;
}

describe('registered API route authentication and role guards', () => {
  beforeEach(() => {
    mongo.reset();
    mongo.insert('users', {
      id: userId,
      is_active: true,
      deleted_at: null,
      role: 'visitor',
      permissions_version: 1,
    });
    mongo.insert('refresh_tokens', {
      id: sessionId,
      user_id: userId,
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
    });
    mongo.insert('roles', {
      name: 'visitor',
      is_system: true,
      permissions_version: 1,
      permissions: [],
    });
  });

  const securedRoutes = Object.entries(openApiSpec.paths).flatMap(([pathname, operations]) =>
    Object.entries(operations)
      .filter(([, operation]) => operation.security?.length)
      .map(([method]) => [method, routePath(pathname)]),
  );

  it.each(securedRoutes)('%s %s rejects unauthenticated requests', async (method, pathname) => {
    await routeRequest(method, pathname).expect(401);
  });

  it.each(securedRoutes)('%s %s rejects an authenticated role without access', async (method, pathname) => {
    await routeRequest(method, pathname, visitorToken).expect(403);
  });

  it('rejects sessions issued before the role permissions version changed', async () => {
    mongo.reset();
    mongo.insert('users', {
      id: userId,
      is_active: true,
      deleted_at: null,
      role: 'visitor',
      permissions_version: 1,
    });
    mongo.insert('roles', {
      name: 'visitor',
      permissions_version: 2,
      permissions: [],
    });
    await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${visitorToken}`)
      .expect(401);
  });
});
