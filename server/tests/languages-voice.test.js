process.env.JWT_ACCESS_SECRET = 'phase-ten-test-access-secret-at-least-32-characters';

jest.mock('../src/db/mongo', () => require('./helpers/mongoMock'));
jest.mock('../src/languages/service', () => ({
  listLanguages: jest.fn(),
  updatePreference: jest.fn(),
}));
jest.mock('../src/adapters/translator', () => ({ translate: jest.fn() }));
jest.mock('../src/adapters/speech', () => ({
  speechToText: jest.fn(),
  textToSpeech: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const mongoMock = require('./helpers/mongoMock');
const languageService = require('../src/languages/service');
const translator = require('../src/adapters/translator');
const speech = require('../src/adapters/speech');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/auth/permissions');

function auth(role = 'doctor') {
  const sessionId = `phase10-${role}`;
  return {
    Authorization: `Bearer ${jwt.sign(
      { role, permissions: DEFAULT_ROLE_PERMISSIONS[role] || [], pv: 1, sid: sessionId },
      process.env.JWT_ACCESS_SECRET,
      { subject: '7c31cbd1-ef65-4e8d-a526-c90dfb51192d', expiresIn: '5m' },
    )}`,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mongoMock.reset();
  mongoMock.insert('users', {
    id: '7c31cbd1-ef65-4e8d-a526-c90dfb51192d',
    role: 'doctor',
    is_active: true,
    deleted_at: null,
    permissions_version: 1,
  });
  mongoMock.insert('roles', {
    name: 'doctor',
    is_system: true,
    permissions_version: 1,
    permissions: DEFAULT_ROLE_PERMISSIONS.doctor,
  });
  mongoMock.insert('refresh_tokens', {
    id: 'phase10-doctor',
    user_id: '7c31cbd1-ef65-4e8d-a526-c90dfb51192d',
    revoked_at: null,
    expires_at: new Date(Date.now() + 60000),
  });
  languageService.listLanguages.mockResolvedValue({
    languages: [{ code: 'en', native_name: 'English', english_name: 'English' }],
  });
  languageService.updatePreference.mockResolvedValue({ language_code: 'te' });
  translator.translate.mockResolvedValue({
    translated_text: 'కృత్రిమ అనువాదం',
    disclaimer: 'AI-assisted translation. Medical translations must be reviewed by qualified clinicians before real-world deployment.',
  });
  speech.speechToText.mockResolvedValue({ transcript: 'synthetic words', language: 'en-IN' });
  speech.textToSpeech.mockResolvedValue({
    fallback: true,
    voice_language: 'en-IN',
    hint: 'Use browser speech synthesis.',
    cache_key: 'f'.repeat(64),
  });
});

describe('Phase 10 language and voice API routes', () => {
  it('serves the public language catalog with cache headers', async () => {
    const response = await request(app).get('/api/languages?lang=te&namespace=app');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('public');
    expect(languageService.listLanguages).toHaveBeenCalledWith({ lang: 'te', namespace: 'app' });
  });

  it('requires authentication and validates preference updates', async () => {
    const unauthorized = await request(app)
      .put('/api/languages/preference')
      .set('Accept-Language', 'te-IN')
      .send({ language_code: 'te' });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.message).toMatch(/కొనసాగించడానికి/);

    const invalid = await request(app)
      .put('/api/languages/preference')
      .set(auth())
      .send({ language_code: 'xx' });
    expect(invalid.status).toBe(400);

    const saved = await request(app)
      .put('/api/languages/preference')
      .set(auth())
      .send({ language_code: 'te' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.language_code).toBe('te');
  });

  it('accepts authenticated translation requests and returns the review notice', async () => {
    const response = await request(app)
      .post('/api/language/translate')
      .set(auth('doctor'))
      .send({ text: 'Basic oral hygiene', source_lang: 'en', target_lang: 'te', mode: 'translate' });
    expect(response.status).toBe(200);
    expect(response.body.data.disclaimer).toMatch(/Medical translations must be reviewed/);
    expect(translator.translate).toHaveBeenCalledWith({
      text: 'Basic oral hygiene',
      source_lang: 'en',
      target_lang: 'te',
      mode: 'translate',
      history: [],
    });
  });

  it('accepts same-language chat requests through the existing translation endpoint', async () => {
    translator.translate.mockResolvedValueOnce({
      translated_text: 'General oral-health education.',
      disclaimer: 'Demonstration only.',
      source: 'gemini',
      mode: 'chat',
    });
    const response = await request(app)
      .post('/api/language/translate')
      .set(auth('doctor'))
      .send({
        text: 'How do I brush safely?',
        source_lang: 'te',
        target_lang: 'te',
        mode: 'chat',
        history: [{ role: 'user', text: 'General oral health question' }],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.mode).toBe('chat');
    expect(translator.translate).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'chat',
      source_lang: 'te',
      target_lang: 'te',
    }));
  });

  it('accepts authenticated audio and offers the browser TTS fallback', async () => {
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
    const recognized = await request(app)
      .post('/api/voice/speech-to-text')
      .set(auth('doctor'))
      .field('language', 'en-IN')
      .field('duration_seconds', '1')
      .attach('audio', audio, { filename: 'speech.webm', contentType: 'audio/webm' });
    expect(recognized.status).toBe(200);
    expect(recognized.body.data.transcript).toBe('synthetic words');

    const fallback = await request(app)
      .post('/api/voice/text-to-speech')
      .set(auth('doctor'))
      .send({ text: 'Synthetic instructions', language: 'en-IN' });
    expect(fallback.status).toBe(200);
    expect(fallback.body.data).toMatchObject({ fallback: true, voice_language: 'en-IN' });
  });
});
