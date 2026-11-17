const geminiChat = require('../src/adapters/geminiChat');

const originalApiKey = process.env.GEMINI_API_KEY;
const originalModel = process.env.GEMINI_MODEL;
const originalFetch = global.fetch;

describe('Gemini text-only oral-health chatbot adapter', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.GEMINI_MODEL = 'gemini-test-model';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends text only with non-diagnostic instructions and returns the model response', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Brush gently twice each day.' }] } }],
      }),
    });

    await expect(
      geminiChat.chat({
        text: 'How can I care for my teeth?',
        source_lang: 'en',
        history: [{ role: 'user', text: 'General question' }],
      }),
    ).resolves.toBe('Brush gently twice each day.');
    const [url, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toContain('/models/gemini-test-model:generateContent');
    expect(options.headers['x-goog-api-key']).toBe('test-gemini-key');
    expect(body.contents).toHaveLength(2);
    expect(
      body.contents.every(({ parts }) => parts.every(({ text }) => typeof text === 'string')),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/inline_data|image_url/i);
    expect(body.generationConfig).not.toHaveProperty('temperature');
    expect(body.systemInstruction.parts[0].text).toMatch(/Never diagnose/);
    expect(body.systemInstruction.parts[0].text).toMatch(/Do not accept or analyze images/);
  });

  it('does not call Gemini when likely patient identifiers are present', async () => {
    await expect(
      geminiChat.chat({
        text: 'Call me at 9876543210 about oral health',
        source_lang: 'en',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'CHATBOT_INPUT_PRIVATE' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports missing provider configuration and upstream failures explicitly', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(
      geminiChat.chat({ text: 'General question', source_lang: 'en' }),
    ).rejects.toMatchObject({ status: 503, code: 'CHATBOT_UNAVAILABLE' });
    expect(global.fetch).not.toHaveBeenCalled();

    process.env.GEMINI_API_KEY = 'test-gemini-key';
    global.fetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(
      geminiChat.chat({ text: 'General question', source_lang: 'en' }),
    ).rejects.toMatchObject({ status: 502, code: 'CHATBOT_PROVIDER_FAILED' });
  });

  it('rejects malformed or empty provider responses', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) });
    await expect(
      geminiChat.chat({ text: 'General question', source_lang: 'en' }),
    ).rejects.toMatchObject({ status: 502, code: 'CHATBOT_PROVIDER_INVALID_RESPONSE' });
  });
});
