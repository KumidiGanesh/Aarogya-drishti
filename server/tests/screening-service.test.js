const collections = {};
const mockDb = {
  collection: jest.fn((name) => {
    if (!collections[name]) collections[name] = [];
    const records = collections[name];
    const matchesValue = (actual, expected) => {
      if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
        if ('$in' in expected) return expected.$in.includes(actual);
        if ('$gte' in expected && !(actual >= expected.$gte)) return false;
        if ('$lt' in expected && !(actual < expected.$lt)) return false;
        if ('$lte' in expected && !(actual <= expected.$lte)) return false;
        return true;
      }
      if (expected === null) return actual == null;
      return actual instanceof Date && expected instanceof Date
        ? actual.getTime() === expected.getTime()
        : actual === expected;
    };
    const matches = (record, filter = {}) =>
      Object.entries(filter).every(([key, expected]) => {
        if (key === '$or') return expected.some((part) => matches(record, part));
        if (key === '$and') return expected.every((part) => matches(record, part));
        return matchesValue(record[key], expected);
      });
    const cursor = (filter) => {
      let found = records.filter((record) => matches(record, filter));
      const result = {
        sort(spec) {
          found = found.slice().sort((left, right) => {
            for (const [key, direction] of Object.entries(spec)) {
              const a = left[key] instanceof Date ? left[key].getTime() : left[key];
              const b = right[key] instanceof Date ? right[key].getTime() : right[key];
              if (a < b) return -direction;
              if (a > b) return direction;
            }
            return 0;
          });
          return result;
        },
        limit(count) {
          found = found.slice(0, count);
          return result;
        },
        skip(count) {
          found = found.slice(count);
          return result;
        },
        toArray: async () => found.slice(),
        next: async () => found[0] || null,
      };
      return result;
    };
    return {
      find: (filter = {}) => cursor(filter),
      findOne: async (filter = {}) => records.find((record) => matches(record, filter)) || null,
      insertOne: async (record) => {
        records.push(record);
        return { acknowledged: true, insertedId: record.id };
      },
      insertMany: async (items) => {
        records.push(...items);
        return { acknowledged: true };
      },
      countDocuments: async (filter = {}) =>
        records.filter((record) => matches(record, filter)).length,
      updateOne: async (filter, update) => {
        const record = records.find((item) => matches(item, filter));
        if (!record) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(record, update.$set || {});
        return { matchedCount: 1, modifiedCount: 1 };
      },
      deleteMany: async (filter) => {
        const before = records.length;
        collections[name] = records.filter((record) => !matches(record, filter));
        return { deletedCount: before - collections[name].length };
      },
    };
  }),
};

jest.mock('../src/db/mongo', () => ({ getDb: jest.fn(async () => mockDb) }));
jest.mock('../src/services/notificationService', () => ({
  create: jest.fn(async () => null),
}));
jest.mock('../src/adapters/geminiScreening', () => ({
  analyze: jest.fn(),
  MAX_IMAGE_BYTES: 12 * 1024 * 1024,
}));

const screeningService = require('../src/screenings/service');
const geminiScreening = require('../src/adapters/geminiScreening');
const imageStorage = require('../src/adapters/privateImageStorage');

const patientId = 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const screeningId = 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const userId = 'e4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const clientUuid = 'f4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const originalGeminiEnv = {
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL,
  demoEnabled: process.env.AI_DEMO_ENABLED,
};
const patient = {
  id: patientId,
  user_id: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  phc_id: null,
  village_id: null,
  is_active: true,
  deleted_at: null,
};
const screening = {
  id: screeningId,
  patient_id: patientId,
  screened_by: userId,
  phc_id: null,
  status: 'draft',
  notes: '',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  screened_at: new Date('2026-01-01T00:00:00.000Z'),
};
const req = {
  user: { sub: userId, role: 'doctor' },
  ip: '127.0.0.1',
  get: () => 'screening-service-test',
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.GEMINI_API_KEY;
  if (originalGeminiEnv.model === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalGeminiEnv.model;
  delete process.env.AI_DEMO_ENABLED;
  geminiScreening.analyze.mockReset();
  for (const key of Object.keys(collections)) delete collections[key];
  collections.patients = [{ ...patient }];
  collections.doctors = [{ id: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce', user_id: userId }];
  collections.appointments = [
    {
      id: 'c4b33580-1c35-4ae3-bf49-1f35532fd3cf',
      doctor_id: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
      patient_id: patientId,
      deleted_at: null,
    },
  ];
  collections.oral_screenings = [{ ...screening }];
  collections.patient_consents = [
    {
      id: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
      patient_id: patientId,
      consent_type: 'data_collection',
      granted: true,
    },
  ];
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalGeminiEnv.apiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiEnv.apiKey;
  if (originalGeminiEnv.model === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalGeminiEnv.model;
  if (originalGeminiEnv.demoEnabled === undefined) delete process.env.AI_DEMO_ENABLED;
  else process.env.AI_DEMO_ENABLED = originalGeminiEnv.demoEnabled;
});

describe('screening service consent, idempotency, and access', () => {
  it('sends an owned, consented screening with images to an active doctor', async () => {
    const patientUser = { sub: patient.user_id, role: 'patient' };
    const doctorId = 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce';
    collections.doctors = [{ id: doctorId, user_id: userId, specialty: 'Oral health' }];
    collections.users = [
      { id: userId, role: 'doctor', is_active: true, full_name: 'Synthetic doctor' },
    ];
    collections.patient_consents.push({
      patient_id: patientId,
      consent_type: 'photo',
      granted: true,
    });
    collections.oral_images = [{ id: 'image-1', screening_id: screeningId }];

    const result = await screeningService.createDoctorRequest(screeningId, doctorId, patientUser, {
      ...req,
      user: patientUser,
    });

    expect(result.created).toBe(true);
    expect(result.request).toMatchObject({
      screening_id: screeningId,
      patient_id: patientId,
      doctor_id: doctorId,
      status: 'submitted',
    });
    expect(collections.audit_logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'screening.doctor_request.created' }),
      ]),
    );
  });

  it('rejects doctor sharing when photo consent or uploaded images are missing', async () => {
    const patientUser = { sub: patient.user_id, role: 'patient' };
    const doctorId = 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce';
    collections.doctors = [{ id: doctorId, user_id: userId }];
    collections.users = [{ id: userId, role: 'doctor', is_active: true }];

    await expect(
      screeningService.createDoctorRequest(screeningId, doctorId, patientUser, {
        ...req,
        user: patientUser,
      }),
    ).rejects.toMatchObject({ status: 403, code: 'PHOTO_CONSENT_REQUIRED' });
    expect(collections.screening_doctor_requests).toBeUndefined();
  });

  it('lets only the assigned doctor start review and limits their screening scope to the request', async () => {
    const doctorId = 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce';
    collections.doctors = [{ id: doctorId, user_id: userId }];
    collections.screening_doctor_requests = [
      {
        id: 'request-1',
        screening_id: screeningId,
        patient_id: patientId,
        doctor_id: doctorId,
        status: 'submitted',
      },
    ];

    const result = await screeningService.updateDoctorRequestStatus(
      screeningId,
      'under_review',
      req.user,
      req,
    );

    expect(result.status).toBe('under_review');
    expect(collections.screening_doctor_requests[0].status).toBe('under_review');
    expect(collections.audit_logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'screening.doctor_request.review_started' }),
      ]),
    );
  });

  it('stores the doctor-authored follow-up and responds to the assigned request', async () => {
    const doctorId = 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce';
    collections.doctors = [{ id: doctorId, user_id: userId }];
    collections.screening_doctor_requests = [
      {
        id: 'request-1',
        screening_id: screeningId,
        patient_id: patientId,
        doctor_id: doctorId,
        status: 'under_review',
      },
    ];

    const result = await screeningService.submitClinicalReview(
      screeningId,
      {
        observations: 'Clinical examination notes.',
        provisional_notes: 'Review notes.',
        follow_up_recommendation: 'Return for a clinical recheck.',
        follow_up_date: '2026-03-15',
        recommend_referral: false,
        recommended_investigations: [],
        ai_observation_decisions: [],
        review_status: 'completed',
      },
      req.user,
      req,
    );

    expect(result.review).toMatchObject({
      observations: 'Clinical examination notes.',
      follow_up_recommendation: 'Return for a clinical recheck.',
      follow_up_date: '2026-03-15',
    });
    expect(collections.screening_doctor_requests[0].status).toBe('responded');
  });

  it('requires separate AI-processing consent before decrypting or sending images', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    collections.oral_images = [
      {
        id: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
        screening_id: screeningId,
        image_mime_type: 'image/jpeg',
      },
    ];
    const decryptSpy = jest.spyOn(imageStorage, 'decryptStoredImage');
    await expect(screeningService.runAiAnalysis(screeningId, req.user, req)).rejects.toMatchObject({
      status: 403,
      code: 'AI_PROCESSING_CONSENT_REQUIRED',
    });
    expect(decryptSpy).not.toHaveBeenCalled();
    expect(geminiScreening.analyze).not.toHaveBeenCalled();
  });

  it('sends only questionnaire codes, selected risk flags, and authorized images to Gemini', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL = 'gemini-test';
    collections.patient_consents.push({
      id: 'a4b33580-1c35-4ae3-bf49-1f35532fd3cf',
      patient_id: patientId,
      consent_type: 'ai_processing',
      granted: true,
      version: 1,
    });
    collections.users = [
      {
        id: patient.user_id,
        preferred_language: 'te',
        full_name: 'Synthetic patient',
      },
    ];
    collections.medical_histories = [
      {
        patient_id: patientId,
        conditions: ['private free-text condition'],
        tobacco_use: true,
        gutkha_use: false,
        areca_nut_use: false,
      },
    ];
    collections.symptoms = [
      {
        id: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
        screening_id: screeningId,
        symptom_code: 'white_patch',
        severity: 'moderate',
        duration_days: 8,
        description: 'private symptom notes',
      },
    ];
    collections.oral_images = [
      {
        id: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
        screening_id: screeningId,
        image_mime_type: 'image/jpeg',
        quality_score: 0.8,
        quality_notes: [],
        quality_status: 'accepted',
        site: 'left_cheek',
        width: 1200,
        height: 900,
      },
    ];
    jest
      .spyOn(imageStorage, 'decryptStoredImage')
      .mockResolvedValue(Buffer.from('synthetic image'));
    geminiScreening.analyze.mockResolvedValue({
      model_version: 'gemini-test',
      model_provider: 'Gemini',
      report: {
        analysis_status: 'completed',
        image_analyzed: true,
        oral_region_detected: true,
        image_limitations: [],
        uncertainty: [],
        visible_observations: [
          {
            type: 'white_area',
            location: 'inner cheek',
            description: 'Visible white area requiring clinical review.',
          },
        ],
      },
    });
    const result = await screeningService.runAiAnalysis(screeningId, req.user, req);
    expect(geminiScreening.analyze).toHaveBeenCalledWith({
      images: [
        expect.objectContaining({
          mime_type: 'image/jpeg',
          site: 'left_cheek',
          buffer: Buffer.from('synthetic image'),
        }),
      ],
    });
    expect(JSON.stringify(geminiScreening.analyze.mock.calls[0])).not.toMatch(
      /patient_id|Synthetic patient|private free-text condition|private symptom notes/i,
    );
    expect(result).toMatchObject({
      is_demo: false,
      risk_category: null,
      confidence: null,
      model_version: 'gemini-test',
      inference_status: 'completed',
      result_data: {
        source: 'vision_inference',
        image_analyzed: true,
        visible_observations: [{ type: 'white_area' }],
      },
    });
    expect(collections.audit_logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'screening.vision_inference_requested',
          metadata: expect.objectContaining({
            image_count: 1,
            consent_version: 1,
            model_version: 'gemini-test',
          }),
        }),
        expect.objectContaining({
          action: 'screening.vision_ai_analysis',
          metadata: expect.objectContaining({ is_demo: false, image_count: 1 }),
        }),
      ]),
    );
  });

  it('keeps the configured demonstration path explicitly image-blind', async () => {
    const result = await screeningService.runAiAnalysis(screeningId, req.user, req);
    expect(result).toMatchObject({
      is_demo: true,
      result_data: {
        source: 'questionnaire_demo',
        inference_status: 'not_performed',
        image_analyzed: false,
        visible_observations: [],
        image_quality: { explanation: 'No image was uploaded.' },
      },
    });
    expect(geminiScreening.analyze).not.toHaveBeenCalled();
  });

  it('keeps uploaded images out of the questionnaire-only demo', async () => {
    collections.oral_images = [
      {
        id: 'image-1',
        screening_id: screeningId,
        quality_score: 0.9,
        quality_notes: [],
        quality_status: 'accepted',
      },
    ];
    const result = await screeningService.runAiAnalysis(screeningId, req.user, req);
    expect(result).toMatchObject({
      risk_category: null,
      confidence: null,
      is_demo: true,
      inference_status: 'not_performed',
    });
    expect(result.result_data).toMatchObject({
      image_analyzed: false,
      visible_observations: [],
      source: 'questionnaire_demo',
    });
    expect(geminiScreening.analyze).not.toHaveBeenCalled();
  });

  it('marks poor-quality images inconclusive and skips model inference', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    collections.patient_consents.push({
      patient_id: patientId,
      consent_type: 'ai_processing',
      granted: true,
      version: 1,
    });
    collections.oral_images = [
      {
        id: 'image-2',
        screening_id: screeningId,
        image_mime_type: 'image/jpeg',
        quality_score: 0.8,
        quality_notes: ['too bright'],
        quality_status: 'accepted',
        site: 'front',
        width: 1200,
        height: 900,
      },
    ];
    jest.spyOn(imageStorage, 'decryptStoredImage').mockResolvedValue(Buffer.from('image bytes'));
    const result = await screeningService.runAiAnalysis(screeningId, req.user, req);
    expect(result.inference_status).toBe('inconclusive');
    expect(result.result_data.visible_observations).toEqual([]);
    expect(geminiScreening.analyze).not.toHaveBeenCalled();
  });

  it('stores failed inference status and rethrows provider errors without a fabricated result', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    collections.patient_consents.push({
      patient_id: patientId,
      consent_type: 'ai_processing',
      granted: true,
      version: 1,
    });
    collections.oral_images = [
      {
        id: 'image-3',
        screening_id: screeningId,
        image_mime_type: 'image/jpeg',
        quality_score: 0.9,
        quality_notes: [],
        quality_status: 'accepted',
        site: 'front',
        width: 1200,
        height: 900,
      },
    ];
    jest.spyOn(imageStorage, 'decryptStoredImage').mockResolvedValue(Buffer.from('image bytes'));
    const providerError = Object.assign(new Error('provider unavailable'), {
      status: 502,
      code: 'GEMINI_PROVIDER_FAILED',
    });
    geminiScreening.analyze.mockRejectedValue(providerError);
    await expect(screeningService.runAiAnalysis(screeningId, req.user, req)).rejects.toBe(
      providerError,
    );
    expect(collections.ai_screening_results[0]).toMatchObject({
      inference_status: 'failed',
      risk_category: null,
      confidence: null,
      result_data: {
        analysis_status: 'unavailable',
        image_analyzed: false,
        visible_observations: [],
        inference_error_code: 'GEMINI_PROVIDER_FAILED',
      },
    });
    expect(collections.oral_screenings[0].status).toBe('analysis_failed');
  });
  it('requires active data-collection consent before creating a new screening', async () => {
    collections.patient_consents = [];
    await expect(
      screeningService.createScreening(
        {
          patient_id: patientId,
          symptoms: [],
          notes: '',
          client_uuid: clientUuid,
        },
        req,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'DATA_COLLECTION_CONSENT_REQUIRED',
    });
    expect(collections.oral_screenings).toHaveLength(1);
  });

  it('returns an existing same-owner screening before checking current consent again', async () => {
    collections.oral_screenings.push({
      ...screening,
      id: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
      client_uuid: clientUuid,
    });
    collections.patient_consents = [];
    const result = await screeningService.createScreening(
      {
        patient_id: patientId,
        symptoms: [],
        notes: '',
        client_uuid: clientUuid,
      },
      req,
    );
    expect(result.created).toBe(false);
    expect(result.screening.id).toBe('b4b33580-1c35-4ae3-bf49-1f35532fd3ce');
  });

  it('persists new screening and symptom documents with string UUIDs and audit metadata', async () => {
    const result = await screeningService.createScreening(
      {
        patient_id: patientId,
        symptoms: [
          { code: 'mouth_ulcer', severity: 'moderate', duration_days: 5, entered_via: 'typed' },
        ],
        notes: 'Synthetic screening',
        client_uuid: clientUuid,
      },
      req,
    );
    expect(result.created).toBe(true);
    expect(result.screening.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(collections.symptoms[0]).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      screening_id: result.screening.id,
      symptom_code: 'mouth_ulcer',
      symptom_codes: ['mouth_ulcer'],
    });
    expect(collections.audit_logs[0]).toMatchObject({
      action: 'screening.created',
      entity: 'oral_screening',
      entity_id: result.screening.id,
    });
  });

  it('allows patients to create screenings only for their own linked patient record', async () => {
    const patientRequest = {
      ...req,
      user: { sub: patient.user_id, role: 'patient' },
    };
    collections.oral_screenings = [];
    const created = await screeningService.createScreening(
      {
        patient_id: patientId,
        symptoms: [
          { code: 'mouth_ulcer', severity: 'moderate', duration_days: 5, entered_via: 'typed' },
        ],
        notes: '',
        client_uuid: clientUuid,
      },
      patientRequest,
    );
    expect(created.created).toBe(true);

    collections.oral_screenings = [];
    collections.patients = [{ ...patient, user_id: userId }];
    await expect(
      screeningService.createScreening(
        {
          patient_id: patientId,
          symptoms: [
            { code: 'mouth_ulcer', severity: 'moderate', duration_days: 5, entered_via: 'typed' },
          ],
          notes: '',
          client_uuid: clientUuid,
        },
        patientRequest,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(collections.oral_screenings).toHaveLength(0);
  });

  it('blocks image upload when photo consent is missing', async () => {
    await expect(
      screeningService.uploadImages(
        screeningId,
        [{ buffer: Buffer.from('unused'), mimetype: 'image/jpeg' }],
        { site: 'front', acceptLowQuality: false },
        req.user,
        req,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'PHOTO_CONSENT_REQUIRED' });
  });

  it('allows self-service image upload only after photo consent', async () => {
    const patientUser = { sub: patient.user_id, role: 'patient' };
    await expect(
      screeningService.uploadImages(
        screeningId,
        [{ buffer: Buffer.from('unused'), mimetype: 'image/jpeg' }],
        { site: 'front', acceptLowQuality: false },
        patientUser,
        { ...req, user: patientUser },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'PHOTO_CONSENT_REQUIRED' });
  });
  it('limits patient access to their own screening record', async () => {
    const patientUser = { sub: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce', role: 'patient' };
    await expect(
      screeningService.screeningDetail(screeningId, patientUser, { query: {} }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('blocks health workers outside their assigned village or PHC', async () => {
    await expect(
      screeningService.uploadImages(
        screeningId,
        [{ buffer: Buffer.from('unused'), mimetype: 'image/jpeg' }],
        { site: 'front', acceptLowQuality: false },
        { sub: userId, role: 'health_worker' },
        req,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'OUTSIDE_ASSIGNED_AREA' });
  });

  it('limits specialists to screenings referred to their account', async () => {
    collections.specialists = [{ id: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce', user_id: userId }];
    await expect(
      screeningService.screeningDetail(
        screeningId,
        { sub: userId, role: 'specialist' },
        { query: {} },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('returns paginated screening history without medical risk categories', async () => {
    collections.ai_screening_results = [
      {
        id: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
        screening_id: screeningId,
        risk_category: 'high',
        created_at: new Date(),
      },
    ];
    const page = await screeningService.listScreenings({ page: '1', limit: '1' }, req.user);
    expect(page.items.map((item) => item.id)).toEqual([screeningId]);
    expect(page.items[0].risk_category).toBeNull();
    expect(page.meta).toMatchObject({ page: 1, limit: 1, total: 1, totalPages: 1 });
  });
});
