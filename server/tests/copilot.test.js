process.env.JWT_ACCESS_SECRET = 'copilot-test-access-secret-at-least-32-characters';

jest.mock('../src/adapters/geminiChat', () => ({
  chat: jest.fn(),
  CHATBOT_NOTICE: 'Educational information only.',
}));

const request = require('supertest');
const app = require('../src/app');
const geminiChat = require('../src/adapters/geminiChat');

describe('Home Page copilot API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports whether the online model is configured without exposing credentials', async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-secret';

    const response = await request(app).get('/api/copilot/health');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ configured: true });
    expect(JSON.stringify(response.body)).not.toContain('test-secret');
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });

  it('sends a validated multilingual question and bounded history to the server-side model', async () => {
    geminiChat.chat.mockResolvedValue('Synthetic educational answer');

    const response = await request(app).post('/api/copilot/chat').send({
      text: 'నోటిలో తెల్లటి మచ్చ గురించి ఏమి తెలుసుకోవాలి?',
      language: 'te',
      history: [{ role: 'user', text: 'మునుపటి ప్రశ్న' }],
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      answer: 'Synthetic educational answer',
      disclaimer: 'Educational information only.',
      source: 'gemini',
    });
    expect(geminiChat.chat).toHaveBeenCalledWith({
      text: 'నోటిలో తెల్లటి మచ్చ గురించి ఏమి తెలుసుకోవాలి?',
      source_lang: 'te',
      history: [{ role: 'user', text: 'మునుపటి ప్రశ్న' }],
      domain: 'general-health',
    });
  });

  it('rejects unsupported language codes before contacting the model', async () => {
    const response = await request(app).post('/api/copilot/chat').send({
      text: 'What is oral cancer?',
      language: 'fr',
      history: [],
    });

    expect(response.status).toBe(400);
    expect(geminiChat.chat).not.toHaveBeenCalled();
  });
});
