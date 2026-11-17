jest.mock('../src/db/mongo', () => {
  const mongoMock = require('./helpers/mongoMock');
  return {
    ...mongoMock,
    getDb: jest.fn(async () => mongoMock.getDb()),
  };
});

const { getDb } = require('../src/db/mongo');
const mongoMock = require('./helpers/mongoMock');
const translator = require('../src/adapters/translator');
const speech = require('../src/adapters/speech');
const service = require('../src/languages/service');
const schemas = require('../src/languages/validators');

function makeWav(durationSeconds) {
  const sampleRate = 8000;
  const dataLength = sampleRate * 2 * durationSeconds;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mongoMock.reset();
  getDb.mockImplementation(() => mongoMock.getDb());
  delete process.env.TRANSLATION_PROVIDER_URL;
  delete process.env.TRANSLATION_PROVIDER_TOKEN;
  delete process.env.SPEECH_TO_TEXT_PROVIDER_URL;
  delete process.env.SPEECH_TO_TEXT_PROVIDER_TOKEN;
  delete process.env.TEXT_TO_SPEECH_PROVIDER_URL;
  delete process.env.TEXT_TO_SPEECH_PROVIDER_TOKEN;
});

describe('Phase 10 language and voice adapters', () => {
  it('returns a localized curated oral-health explanation with the required disclaimer', async () => {
    const result = await translator.translate({
      text: 'Explain mouth ulcers',
      source_lang: 'en',
      target_lang: 'te',
      mode: 'explain_oral_health',
    });
    expect(result.source).toBe('curated');
    expect(result.translated_text).toContain('రెండు వారాలకంటే ఎక్కువ');
    expect(result.disclaimer).toBe(translator.REVIEW_NOTICE);
    expect(result.translated_text).not.toMatch(/diagnos/i);
  });

  it('uses an exact server-managed translation phrase when no provider is configured', async () => {
    const findOne = jest.fn(async (filter) => {
      if (filter.language_code === 'en') return { key: 'greetings.good_morning', value: 'Good morning' };
      return { key: 'greetings.good_morning', value: 'శుభోదయం' };
    });
    getDb.mockResolvedValueOnce({
      collection: () => ({ findOne }),
    });
    const result = await translator.translate({
      text: 'Good morning',
      source_lang: 'en',
      target_lang: 'te',
      mode: 'translate',
    });
    expect(result).toMatchObject({
      translated_text: 'శుభోదయం',
      source: 'translation_contents',
      disclaimer: translator.REVIEW_NOTICE,
    });
    expect(findOne).toHaveBeenNthCalledWith(1, expect.objectContaining({
      language_code: 'en',
      value: { $regex: '^Good morning$', $options: 'i' },
    }));
    expect(findOne).toHaveBeenNthCalledWith(2, { key: 'greetings.good_morning', language_code: 'te' });
  });

  it('returns a clear not-configured result for unsupported offline phrases', async () => {
    getDb.mockResolvedValueOnce({
      collection: () => ({ findOne: jest.fn().mockResolvedValue(null) }),
    });
    await expect(translator.translate({
      text: 'An unknown phrase',
      source_lang: 'en',
      target_lang: 'or',
      mode: 'translate',
    })).rejects.toMatchObject({ status: 501, code: 'TRANSLATION_UNAVAILABLE' });
  });

  it('limits translations to English and one regional language and 2,000 characters', () => {
    const base = { source_lang: 'te', target_lang: 'hi', mode: 'translate', text: 'Hello' };
    expect(schemas.translate.safeParse({ body: base }).success).toBe(false);
    expect(schemas.translate.safeParse({
      body: { ...base, source_lang: 'en', target_lang: 'te', text: 'a'.repeat(2001) },
    }).success).toBe(false);
    expect(schemas.translate.safeParse({
      body: { ...base, source_lang: 'en', target_lang: 'or' },
    }).success).toBe(true);
  });

  it('persists language preference and linked-patient preference with an audit event', async () => {
    const users = {
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const languages = {
      findOne: jest.fn().mockResolvedValue({ code: 'te', is_active: true }),
    };
    const patients = {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const audits = { insertOne: jest.fn().mockResolvedValue({ acknowledged: true }) };
    const db = {
      collection: jest.fn((name) => ({
        users,
        languages,
        patients,
        audit_logs: audits,
      })[name]),
    };
    getDb.mockResolvedValueOnce(db);
    const req = { ip: '127.0.0.1', get: () => 'test-agent' };

    await expect(service.updatePreference('user-id', 'te', req)).resolves.toEqual({ language_code: 'te' });
    expect(users.updateOne).toHaveBeenCalledWith(
      { id: 'user-id', is_active: true, deleted_at: null },
      { $set: { preferred_language: 'te', updated_at: expect.any(Date) } },
    );
    expect(patients.updateMany).toHaveBeenCalledWith(
      { user_id: 'user-id', deleted_at: null },
      { $set: { preferred_language: 'te', updated_at: expect.any(Date) } },
    );
    expect(audits.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      action: 'language.preference.updated',
      user_id: 'user-id',
      metadata: { preferred_language: 'te' },
    }));
  });

  it('uses localized browser speech fallback when no TTS provider is configured', async () => {
    const result = await speech.textToSpeech('Synthetic text', 'or-IN');
    expect(result).toMatchObject({
      fallback: true,
      voice_language: 'or-IN',
      hint: expect.stringContaining('ବ୍ରାଉଜର'),
    });
    expect(result.cache_key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('only accepts MP3 audio from a configured TTS provider', async () => {
    process.env.TEXT_TO_SPEECH_PROVIDER_URL = 'https://provider.invalid/tts';
    process.env.TEXT_TO_SPEECH_PROVIDER_TOKEN = 'synthetic-test-token';
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([0xff, 0xfb, 0x90, 0x64]).buffer,
    });
    global.fetch = fetchMock;
    try {
      const result = await speech.textToSpeech('Synthetic MP3 response', 'en-IN');
      expect(result.audio).toEqual(Buffer.from([0xff, 0xfb, 0x90, 0x64]));
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Uint8Array.from(Buffer.from('not mp3')).buffer,
      });
      await expect(speech.textToSpeech('Invalid audio response', 'en-IN'))
        .rejects.toMatchObject({ status: 502, code: 'TTS_PROVIDER_INVALID_AUDIO' });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('validates WAV signatures and enforces measured recording duration', () => {
    expect(speech.validateAudio({
      mimetype: 'audio/wav',
      buffer: makeWav(60),
    }, 60)).toBe('audio/wav');
    let durationError;
    let typeError;
    try {
      speech.validateAudio({ mimetype: 'audio/wav', buffer: makeWav(61) }, 1);
    } catch (error) {
      durationError = error;
    }
    try {
      speech.validateAudio({ mimetype: 'audio/webm', buffer: Buffer.from('not audio') }, 1);
    } catch (error) {
      typeError = error;
    }
    expect(durationError).toMatchObject({ status: 422, code: 'AUDIO_DURATION_INVALID' });
    expect(typeError).toMatchObject({ status: 422, code: 'UNSUPPORTED_AUDIO_TYPE' });
  });

  it('uses the server Gemini key to transcribe audio when no separate provider is configured', async () => {
    const originalApiKey = process.env.GEMINI_API_KEY;
    const originalModel = process.env.GEMINI_MODEL;
    const originalFetch = global.fetch;
    process.env.GEMINI_API_KEY = 'synthetic-test-key';
    process.env.GEMINI_MODEL = 'gemini-test-model';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'నోటి నొప్పి ఉంది' }] } }],
      }),
    });
    global.fetch = fetchMock;
    try {
      const result = await speech.speechToText({
        mimetype: 'audio/wav',
        buffer: makeWav(1),
      }, 'te-IN', 1);
      expect(result).toEqual({ transcript: 'నోటి నొప్పి ఉంది', language: 'te-IN' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent',
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-goog-api-key': 'synthetic-test-key' }),
        }),
      );
      const request = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(request.contents[0].parts[1].inline_data).toMatchObject({
        mime_type: 'audio/wav',
      });
      expect(request.systemInstruction.parts[0].text).toContain('te-IN');
    } finally {
      global.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalApiKey;
      if (originalModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = originalModel;
    }
  });

  it('returns explicit errors when Gemini transcription is unavailable or over quota', async () => {
    const originalApiKey = process.env.GEMINI_API_KEY;
    const originalFetch = global.fetch;
    try {
      delete process.env.GEMINI_API_KEY;
      await expect(speech.speechToText({
        mimetype: 'audio/wav',
        buffer: makeWav(1),
      }, 'en-IN', 1)).rejects.toMatchObject({
        status: 501,
        code: 'SERVER_STT_UNAVAILABLE',
      });

      process.env.GEMINI_API_KEY = 'synthetic-test-key';
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
      await expect(speech.speechToText({
        mimetype: 'audio/wav',
        buffer: makeWav(1),
      }, 'en-IN', 1)).rejects.toMatchObject({
        status: 502,
        code: 'GEMINI_QUOTA_EXCEEDED',
      });
    } finally {
      global.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalApiKey;
    }
  });
});
