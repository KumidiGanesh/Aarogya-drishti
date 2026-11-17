const request = require('supertest');
jest.mock('../src/db/mongo', () => ({
  ...jest.requireActual('../src/db/mongo'),
  checkConnection: jest.fn(),
}));

const { checkConnection } = require('../src/db/mongo');
const app = require('../src/app');

beforeEach(() => {
  checkConnection.mockResolvedValue(undefined);
});

describe('GET /healthz', () => {
  it('returns the standard success envelope', async () => {
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { status: 'ok' },
      meta: {},
    });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  describe('GET /api/health', () => {
    it('reports the database as connected only after its connection check succeeds', async () => {
      const response = await request(app).get('/api/health').expect(200);

      expect(checkConnection).toHaveBeenCalledTimes(1);
      expect(response.body).toMatchObject({
        success: true,
        application: 'AAROGYA DRISHTI',
        server: 'running',
        database: 'connected',
        data: { status: 'ok' },
      });
    });

    it('returns an unhealthy status when the database check fails', async () => {
      checkConnection.mockRejectedValueOnce(new Error('database connection failed'));

      const response = await request(app).get('/api/health').expect(503);

      expect(response.body).toMatchObject({
        success: false,
        application: 'AAROGYA DRISHTI',
        server: 'running',
        database: 'disconnected',
        code: 'DATABASE_UNAVAILABLE',
      });
    });
  });

  it('returns the standard not-found envelope for unknown routes', async () => {
    const response = await request(app).get('/missing');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, code: 'NOT_FOUND', errors: [] });
  });

  it('serves the generated OpenAPI definition and Swagger UI', async () => {
    const definition = await request(app).get('/api-docs/openapi.json').expect(200);
    expect(definition.body.openapi).toBe('3.0.3');
    expect(definition.body.paths['/api/screenings/{id}'].get).toBeDefined();
    await request(app).get('/api-docs/').expect(200);
  });

  it('sets baseline security headers on API responses', async () => {
    const response = await request(app).get('/healthz').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('allows the loopback frontend origin during local development', async () => {
    const response = await request(app)
      .options('/api/languages')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
  });

  it('allows Vite fallback port 5174 during local development', async () => {
    const response = await request(app)
      .options('/api/languages')
      .set('Origin', 'http://localhost:5174')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5174');
  });

  it('does not expose local storage paths as public static files', async () => {
    await request(app).get('/storage/private/synthetic-object.jpg').expect(404);
  });
});
