const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { generateDemoResult, DEMO_DISCLAIMER, SAFETY_SENTENCE } = require('../src/adapters/demoAi');
const imageStorage = require('../src/adapters/privateImageStorage');
const geminiScreening = require('../src/adapters/geminiScreening');
const visionProvider = require('../src/adapters/screeningVisionProvider');
const { prepareImage, assertImageSignature } = require('../src/screenings/imageQuality');

let storagePath;
const originalGeminiEnv = {
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL,
};

beforeEach(async () => {
  storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'aarogya-screening-test-'));
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_PATH = storagePath;
  process.env.STORAGE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  process.env.STORAGE_ENCRYPTION_KEY_ID = 'test-key-v1';
});

afterEach(async () => {
  await fs.rm(storagePath, { recursive: true, force: true });
  if (originalGeminiEnv.apiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiEnv.apiKey;
  if (originalGeminiEnv.model === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalGeminiEnv.model;
  jest.restoreAllMocks();
});

describe('screening demonstration and image adapters', () => {
  it('produces deterministic, clearly labelled demonstration output', () => {
    const input = {
      symptoms: [{ symptom_code: 'white_patch', severity: 'severe', duration_days: 20 }],
      history: { gutkha_use: true },
      images: [],
    };
    const first = generateDemoResult(input);
    const second = generateDemoResult(input);
    expect(first).toEqual(second);
    expect(first.risk_category).toBeNull();
    expect(first.confidence).toBeNull();
    expect(first.result_data.image_analyzed).toBe(false);
    expect(first.result_data.analysis_status).toBe('demonstration_only');
    expect(first.disclaimer).toBe(DEMO_DISCLAIMER);
    expect(first.safety_sentence).toBe(SAFETY_SENTENCE);
    expect(JSON.stringify(first)).not.toMatch(/cancer diagnosis/i);
    expect(first.is_demo).toBe(true);
  });

  it('encrypts local image bytes and verifies the authenticated round-trip', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x01, 0x02]);
    const metadata = await imageStorage.encryptAndStore(jpeg);
    const stored = await fs.readFile(path.join(storagePath, `${metadata.storage_key}.enc`));
    expect(stored.subarray(0, 3)).not.toEqual(jpeg.subarray(0, 3));
    expect(await imageStorage.decryptStoredImage(metadata)).toEqual(jpeg);
    const second = await imageStorage.encryptAndStore(jpeg);
    expect(second.encryption_iv).not.toBe(metadata.encryption_iv);
  });

  it('rejects tampered encrypted content and invalid object keys', async () => {
    const stored = await imageStorage.encryptAndStore(Buffer.from('synthetic image'));
    await fs.writeFile(
      path.join(storagePath, `${stored.storage_key}.enc`),
      Buffer.from('tampered'),
    );
    await expect(imageStorage.decryptStoredImage(stored)).rejects.toThrow();
    await expect(
      imageStorage.decryptStoredImage({ ...stored, storage_key: '..\\outside' }),
    ).rejects.toMatchObject({ code: 'IMAGE_STORAGE_KEY_INVALID' });
  });

  it('rejects MIME/signature mismatches and reports low-resolution and blur signals', async () => {
    expect(() => assertImageSignature(Buffer.from('not an image'), 'image/jpeg')).toThrow();
    const small = await sharp({
      create: {
        width: 300,
        height: 200,
        channels: 3,
        background: { r: 80, g: 80, b: 80 },
      },
    })
      .jpeg()
      .withMetadata({ orientation: 1 })
      .toBuffer();
    expect((await sharp(small).metadata()).exif).toBeDefined();
    const result = await prepareImage(small, 'image/jpeg');
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
    expect(result.qualityNotes).toContain('too small');
    expect(result.qualityNotes).toContain('blurry');
    const outputMetadata = await sharp(result.buffer).metadata();
    expect(outputMetadata.exif).toBeUndefined();
  });

  it('does not flag a portrait image as small when its pixel count meets the minimum', async () => {
    const portrait = await sharp({
      create: {
        width: 600,
        height: 800,
        channels: 3,
        background: { r: 120, g: 90, b: 80 },
      },
    })
      .jpeg()
      .toBuffer();

    const result = await prepareImage(portrait, 'image/jpeg');

    expect(result.width).toBe(600);
    expect(result.height).toBe(800);
    expect(result.qualityNotes).not.toContain('too small');
  });

  it('does not flag a well-lit image as dark because it contains dark regions', async () => {
    const image = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 220, g: 220, b: 220 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 300,
              height: 300,
              channels: 3,
              background: { r: 25, g: 25, b: 25 },
            },
          })
            .png()
            .toBuffer(),
          left: 250,
          top: 150,
        },
      ])
      .jpeg()
      .toBuffer();

    const result = await prepareImage(image, 'image/jpeg');

    expect(result.qualityNotes).not.toContain('too dark');
  });

  it('still flags an image that is consistently underexposed', async () => {
    const image = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 25, g: 25, b: 25 },
      },
    })
      .jpeg()
      .toBuffer();

    const result = await prepareImage(image, 'image/jpeg');

    expect(result.qualityNotes).toContain('too dark');
  });

  it('sends actual image bytes only to Gemini and validates the visual response', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const report = {
      analysis_status: 'completed',
      image_analyzed: true,
      oral_region_detected: true,
      image_limitations: [],
      uncertainty: ['This general-purpose model is not clinically validated.'],
      visible_observations: [
        {
          type: 'white_area',
          location: 'inner cheek',
          description: 'A visible white area; clinical examination is needed.',
        },
      ],
    };
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(report) }] } }],
      }),
    });
    const imageBytes = Buffer.from('sanitized synthetic image');
    const result = await visionProvider.analyze({
      images: [
        {
          buffer: imageBytes,
          mime_type: 'image/jpeg',
          site: 'left_cheek',
          quality_score: 0.9,
          quality_notes: [],
          width: 1200,
          height: 900,
        },
      ],
      symptoms: [{ code: 'white_patch', severity: 'mild', duration_days: 4 }],
      risk_factors: { tobacco_use: true, gutkha_use: false, areca_nut_use: false },
      language: 'en',
    });
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    const parts = request.contents[0].parts;
    expect(result.report).toMatchObject({
      ...report,
      model_provider: 'Gemini',
      clinical_validation_status: 'not_validated',
    });
    expect(fetch.mock.calls[0][0]).toContain('/models/gemini-3.5-flash-lite:generateContent');
    expect(request.generationConfig).not.toHaveProperty('temperature');
    expect(request.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseSchema: expect.any(Object),
    });
    expect(parts[1].inline_data.data).toBe(imageBytes.toString('base64'));
    expect(JSON.stringify(request)).not.toMatch(/patient_id|full_name|mobile|address/i);
    expect(request.systemInstruction.parts[0].text).toMatch(/do not diagnose/i);
    expect(request.contents[0].parts[0].text).not.toMatch(/symptom|questionnaire|risk.factor/i);
  });

  it('rejects missing configuration and malformed provider reports', async () => {
    await expect(
      geminiScreening.analyze({
        images: [{ buffer: Buffer.from('x'), mime_type: 'image/jpeg' }],
        symptoms: [],
        risk_factors: {},
        language: 'en',
      }),
    ).rejects.toMatchObject({ status: 503, code: 'GEMINI_NOT_CONFIGURED' });

    process.env.GEMINI_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"risk_category":"low"}' }] } }],
      }),
    });
    await expect(
      geminiScreening.analyze({
        images: [{ buffer: Buffer.from('x'), mime_type: 'image/jpeg' }],
        symptoms: [],
        risk_factors: {},
        language: 'en',
      }),
    ).rejects.toMatchObject({ status: 502, code: 'GEMINI_INVALID_RESPONSE' });
  });

  it('reports Gemini timeouts without returning a screening result', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(
      geminiScreening.analyze({
        images: [{ buffer: Buffer.from('image'), mime_type: 'image/jpeg' }],
      }),
    ).rejects.toMatchObject({ status: 504, code: 'GEMINI_TIMEOUT' });
  });

  it.each([
    [400, 'GEMINI_INVALID_REQUEST'],
    [401, 'GEMINI_AUTH_FAILED'],
    [403, 'GEMINI_AUTH_FAILED'],
    [404, 'GEMINI_MODEL_UNAVAILABLE'],
    [429, 'GEMINI_QUOTA_EXCEEDED'],
    [503, 'GEMINI_PROVIDER_FAILED'],
  ])('reports a safe, actionable error for Gemini HTTP %s', async (status, code) => {
    process.env.GEMINI_API_KEY = 'test-key';
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status,
      json: async () => ({
        error: {
          message: 'provider response must not be surfaced',
          status: 'UPSTREAM_PRIVATE_DETAIL',
        },
      }),
    });

    await expect(
      geminiScreening.analyze({
        images: [{ buffer: Buffer.from('synthetic image'), mime_type: 'image/jpeg' }],
      }),
    ).rejects.toMatchObject({ status: 502, code });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported observations and invalid image MIME types', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    analysis_status: 'completed',
                    image_analyzed: true,
                    visible_observations: [
                      { type: 'cancer', location: 'mouth', description: 'diagnosis' },
                    ],
                    oral_region_detected: true,
                    image_limitations: [],
                    uncertainty: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });
    await expect(
      geminiScreening.analyze({
        images: [{ buffer: Buffer.from('image'), mime_type: 'image/jpeg' }],
      }),
    ).rejects.toMatchObject({ status: 502, code: 'GEMINI_INVALID_RESPONSE' });
    await expect(
      geminiScreening.analyze({
        images: [{ buffer: Buffer.from('image'), mime_type: 'text/plain' }],
      }),
    ).rejects.toMatchObject({ status: 422, code: 'AI_INVALID_IMAGE' });
  });
  it('rejects unsupported diagnosis language from model observations', () => {
    expect(
      geminiScreening.reportSchema.safeParse({
        analysis_status: 'completed',
        image_analyzed: true,
        oral_region_detected: true,
        image_limitations: [],
        uncertainty: [],
        visible_observations: [
          { type: 'white_area', location: 'inner cheek', description: 'This is cancer.' },
        ],
      }).success,
    ).toBe(false);
  });
  it('handles Gemini transport failures explicitly', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network unavailable'));
    await expect(
      geminiScreening.analyze({
        images: [{ buffer: Buffer.from('image'), mime_type: 'image/jpeg' }],
      }),
    ).rejects.toMatchObject({ status: 502, code: 'GEMINI_PROVIDER_FAILED' });
  });
});
