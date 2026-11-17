const { z } = require('zod');

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ANALYSIS_TIMEOUT_MS = 45_000;
const observationSchema = z
  .object({
    type: z.enum(['white_area', 'red_area', 'ulcer_like_area', 'unusual_surface_change', 'other']),
    location: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(700),
  })
  .strict();
const reportSchema = z
  .object({
    analysis_status: z.enum(['completed', 'inconclusive']),
    image_analyzed: z.boolean(),
    visible_observations: z.array(observationSchema).max(12),
    oral_region_detected: z.boolean().nullable(),
    image_limitations: z.array(z.string().trim().min(1).max(300)).max(8),
    uncertainty: z.array(z.string().trim().min(1).max(300)).max(8),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.analysis_status === 'completed' && !report.image_analyzed) {
      context.addIssue({
        code: 'custom',
        message: 'Completed analysis must confirm image processing',
      });
    }
    const unsupportedDiagnosis =
      /\b(cancer|carcinoma|malignant|benign|diagnos(?:is|e|ed)|tumou?r|stage\s*[0-4iv]+|leukoplakia|erythroplakia)\b/i;
    report.visible_observations.forEach((observation, index) => {
      if (unsupportedDiagnosis.test(`${observation.location} ${observation.description}`)) {
        context.addIssue({
          code: 'custom',
          path: ['visible_observations', index],
          message: 'Diagnostic claims are not supported',
        });
      }
    });
  });

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    analysis_status: { type: 'STRING', enum: ['completed', 'inconclusive'] },
    image_analyzed: { type: 'BOOLEAN' },
    visible_observations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: {
            type: 'STRING',
            enum: ['white_area', 'red_area', 'ulcer_like_area', 'unusual_surface_change', 'other'],
          },
          location: { type: 'STRING' },
          description: { type: 'STRING' },
        },
        required: ['type', 'location', 'description'],
      },
    },
    oral_region_detected: { type: 'BOOLEAN', nullable: true },
    image_limitations: { type: 'ARRAY', items: { type: 'STRING' } },
    uncertainty: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: [
    'analysis_status',
    'image_analyzed',
    'visible_observations',
    'oral_region_detected',
    'image_limitations',
    'uncertainty',
  ],
};

const SYSTEM_INSTRUCTION = [
  'Inspect the attached image pixels and report only directly visible, non-diagnostic oral features.',
  'Do not infer symptoms from the image; questionnaire context is intentionally not supplied.',
  'Do not diagnose disease, cancer, or stage; do not estimate disease probability or risk.',
  'Do not invent findings. Omit a feature unless it is clearly visible; include uncertainty and limitations.',
  'Set image_analyzed true only when you actually inspected the attached image. If no oral region is visible or the image cannot be interpreted, return inconclusive with no observations.',
  'This general-purpose model is not clinically validated for oral disease screening.',
].join(' ');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function responseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts)
    ? parts
        .map((part) => part.text || '')
        .join('\n')
        .trim()
    : '';
}

function providerHttpError(status) {
  const errors = {
    400: [
      'GEMINI_INVALID_REQUEST',
      'Gemini rejected the screening request. Check the configured model and request settings.',
    ],
    401: [
      'GEMINI_AUTH_FAILED',
      'Gemini rejected the API credentials. Replace the exposed key and verify API access and key restrictions.',
    ],
    403: [
      'GEMINI_AUTH_FAILED',
      'Gemini denied API access. Replace the exposed key and verify API access and key restrictions.',
    ],
    404: [
      'GEMINI_MODEL_UNAVAILABLE',
      'The configured Gemini model was not found. Set GEMINI_MODEL to a model available to this API key.',
    ],
    429: [
      'GEMINI_QUOTA_EXCEEDED',
      'Gemini request quota or rate limit was reached. Check the project quota and billing, then retry.',
    ],
  };
  const [code, message] = errors[status] || [
    'GEMINI_PROVIDER_FAILED',
    'Gemini could not complete this screening. Check provider availability and retry.',
  ];
  return httpError(502, code, message);
}

async function analyze({ images }) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw httpError(503, 'GEMINI_NOT_CONFIGURED', 'Gemini screening is not configured');
  if (!images?.length)
    throw httpError(422, 'AI_IMAGES_REQUIRED', 'Upload at least one oral image before analysis');
  const totalBytes = images.reduce(
    (total, image) => total + (Buffer.isBuffer(image.buffer) ? image.buffer.length : 0),
    0,
  );
  if (totalBytes > MAX_IMAGE_BYTES)
    throw httpError(413, 'AI_IMAGES_TOO_LARGE', 'Select fewer or smaller images for AI analysis');
  if (
    images.some(
      (image) =>
        !Buffer.isBuffer(image.buffer) ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(image.mime_type),
    )
  ) {
    throw httpError(
      422,
      'AI_INVALID_IMAGE',
      'An image has an unsupported format or missing image bytes',
    );
  }
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: 'Inspect the attached image pixels independently. Return only the required structured JSON.',
        },
        ...images.map((image) => ({
          inline_data: { mime_type: image.mime_type, data: image.buffer.toString('base64') },
        })),
      ],
    },
  ];
  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents,
          generationConfig: {
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
        signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
      },
    );
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw httpError(504, 'GEMINI_TIMEOUT', 'Gemini screening did not respond in time');
    throw httpError(
      502,
      'GEMINI_PROVIDER_FAILED',
      'Gemini screening provider could not be reached',
    );
  }
  if (!response.ok) throw providerHttpError(response.status);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw httpError(502, 'GEMINI_INVALID_RESPONSE', 'Gemini returned an invalid response');
  }
  const text = responseText(payload);
  if (!text) throw httpError(502, 'GEMINI_INVALID_RESPONSE', 'Gemini returned no screening report');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw httpError(502, 'GEMINI_INVALID_RESPONSE', 'Gemini returned malformed report JSON');
  }
  const validated = reportSchema.safeParse(parsed);
  if (!validated.success)
    throw httpError(
      502,
      'GEMINI_INVALID_RESPONSE',
      'Gemini returned an incomplete or unsupported screening report',
    );
  return {
    report: validated.data,
    model_version: model,
    model_provider: 'Gemini',
  };
}

module.exports = {
  analyze,
  MAX_IMAGE_BYTES,
  ANALYSIS_TIMEOUT_MS,
  SYSTEM_INSTRUCTION,
  reportSchema,
  providerHttpError,
};
