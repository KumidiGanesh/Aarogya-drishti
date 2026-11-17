const { createHmac } = require('node:crypto');
const mockCollections = new Map();
const mockDb = {
  collection(name) {
    if (!mockCollections.has(name)) mockCollections.set(name, createCollection());
    return mockCollections.get(name);
  },
};

function matches(document, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((condition) => matches(document, condition));
    const actual = document[key];
    if (
      expected &&
      typeof expected === 'object' &&
      !(expected instanceof Date) &&
      !Array.isArray(expected)
    ) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === '$in') return value.includes(actual);
        if (operator === '$ne') return actual !== value;
        if (operator === '$gte') return new Date(actual) >= new Date(value);
        if (operator === '$gt') return new Date(actual) > new Date(value);
        if (operator === '$lte') return new Date(actual) <= new Date(value);
        if (operator === '$lt') return new Date(actual) < new Date(value);
        return false;
      });
    }
    if (actual instanceof Date && expected instanceof Date)
      return actual.getTime() === expected.getTime();
    return actual === expected;
  });
}

function createCollection() {
  const documents = [];
  const collection = {
    documents,
    findOne: jest.fn(async (filter) => documents.find((item) => matches(item, filter)) || null),
    find: jest.fn((filter) => {
      let found = documents.filter((item) => matches(item, filter));
      const cursor = {
        sort: (sort) => {
          const [[field, direction]] = Object.entries(sort);
          found = found.sort(
            (left, right) =>
              (left[field] > right[field] ? 1 : left[field] < right[field] ? -1 : 0) * direction,
          );
          return cursor;
        },
        limit: (count) => {
          found = found.slice(0, count);
          return cursor;
        },
        toArray: async () => found,
        next: async () => found[0] || null,
      };
      return cursor;
    }),
    insertOne: jest.fn(async (document) => {
      documents.push(document);
      return { insertedId: document.id };
    }),
    updateOne: jest.fn(async (filter, update) => {
      const found = documents.find((item) => matches(item, filter));
      if (found) {
        Object.assign(found, update.$set || {});
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (update.$setOnInsert) documents.push({ ...filter, ...update.$setOnInsert });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: update.$setOnInsert ? 1 : 0 };
    }),
    updateMany: jest.fn(async (filter, update) => {
      const found = documents.filter((item) => matches(item, filter));
      found.forEach((item) => Object.assign(item, update.$set || {}));
      return { matchedCount: found.length, modifiedCount: found.length };
    }),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const found = documents.find((item) => matches(item, filter));
      if (!found) return null;
      Object.assign(found, update.$set || {});
      return found;
    }),
    countDocuments: jest.fn(
      async (filter) => documents.filter((item) => matches(item, filter)).length,
    ),
  };
  return collection;
}

jest.mock('../src/db/mongo', () => ({ getDb: jest.fn(async () => mockDb) }));
jest.mock('../src/emergency/smsAdapter', () => ({
  sendSms: jest.fn(async () => ({ delivered: true })),
}));

const consultations = require('../src/consultations/service');
const videoAdapter = require('../src/adapters/video');
const medicines = require('../src/medicines/service');
const emergency = require('../src/emergency/service');
const smsAdapter = require('../src/emergency/smsAdapter');

const ids = {
  patient: 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  doctor: 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  patientUser: 'e4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  doctorUser: 'f4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  appointment: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  consultation: 'a5b33580-1c35-4ae3-bf49-1f35532fd3ce',
  medicine: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  reminder: 'c5b33580-1c35-4ae3-bf49-1f35532fd3ce',
  contact: 'd5b33580-1c35-4ae3-bf49-1f35532fd3ce',
};

const req = { user: { sub: ids.doctorUser }, ip: '127.0.0.1', get: () => 'native-services-test' };

function seed(name, ...documents) {
  mockDb.collection(name).documents.push(...documents);
}

function seedTelemedicineConsultation(status = 'scheduled') {
  seed('appointments', {
    id: ids.appointment,
    patient_id: ids.patient,
    doctor_id: ids.doctor,
    scheduled_at: new Date(),
    status: 'confirmed',
    mode: 'video',
    deleted_at: null,
  });
  seed('consultations', {
    id: ids.consultation,
    appointment_id: ids.appointment,
    patient_id: ids.patient,
    doctor_id: ids.doctor,
    status,
    created_at: new Date(),
  });
  seed('patient_consents', {
    patient_id: ids.patient,
    consent_type: 'teleconsultation',
    granted: true,
  });
}

beforeEach(() => {
  mockCollections.clear();
  process.env.VIDEO_JWT_SECRET = 'native-services-test-secret';
  process.env.STUN_URIS = 'stun:stun.example.test:3478';
  process.env.TURN_URIS = 'turns:turn.example.test:5349';
  process.env.TURN_SHARED_SECRET = 'native-services-turn-shared-secret-at-least-32';
  seed('patients', {
    id: ids.patient,
    user_id: ids.patientUser,
    full_name: 'Synthetic Patient',
    is_active: true,
    preferred_language: 'en',
    district: 'Test District',
    phc_id: 'test-phc',
  });
  seed('doctors', {
    id: ids.doctor,
    user_id: ids.doctorUser,
    phc_id: 'test-phc',
    specialty: 'Dental',
  });
  seed(
    'users',
    {
      id: ids.patientUser,
      role: 'patient',
      is_active: true,
      deleted_at: null,
      preferred_language: 'en',
    },
    {
      id: ids.doctorUser,
      role: 'doctor',
      is_active: true,
      deleted_at: null,
      preferred_language: 'en',
    },
  );
  jest.clearAllMocks();
  smsAdapter.sendSms.mockResolvedValue({ delivered: true });
});

describe('Mongo-backed consultation, medicine, and emergency persistence', () => {
  it('reports signaling readiness only when TURN and call-token secrets are configured', () => {
    const names = ['CALL_TOKEN_SECRET', 'STUN_URIS', 'TURN_URIS', 'TURN_SHARED_SECRET'];
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.CALL_TOKEN_SECRET = 'native-services-call-token-secret-at-least-32';
      process.env.STUN_URIS = 'stun:stun.example.test:3478';
      process.env.TURN_URIS = 'turns:turn.example.test:5349';
      process.env.TURN_SHARED_SECRET = 'native-services-turn-shared-secret-at-least-32';
      expect(consultations.isCallSignalingConfigured()).toBe(true);

      process.env.TURN_URIS = '';
      expect(consultations.isCallSignalingConfigured()).toBe(false);
    } finally {
      names.forEach((name) => {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      });
    }
  });

  it('issues short-lived TURN credentials only to an authorized active appointment participant', async () => {
    seedTelemedicineConsultation();
    const user = { role: 'patient', sub: ids.patientUser };
    const result = await consultations.getIceServers(ids.consultation, user);
    const turn = result.ice_servers.find((server) => server.urls[0].startsWith('turns:'));

    expect(result.ice_servers).toEqual(expect.arrayContaining([
      { urls: ['stun:stun.example.test:3478'] },
      expect.objectContaining({ urls: ['turns:turn.example.test:5349'] }),
    ]));
    expect(turn.username).toContain(ids.patientUser);
    expect(turn.credential).toBe(
      createHmac('sha1', process.env.TURN_SHARED_SECRET)
        .update(turn.username)
        .digest('base64'),
    );
    expect(result.expires_at.getTime()).toBeGreaterThan(Date.now());

    await expect(
      consultations.getIceServers(ids.consultation, { role: 'patient', sub: ids.doctorUser }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('does not issue ICE configuration when TURN infrastructure is missing', async () => {
    seedTelemedicineConsultation();
    delete process.env.TURN_URIS;
    await expect(
      consultations.getIceServers(ids.consultation, {
        role: 'patient',
        sub: ids.patientUser,
      }),
    ).rejects.toMatchObject({ status: 503, code: 'ICE_SERVERS_UNAVAILABLE' });
  });

  it('creates real call records and allows only the invited appointment participant to accept', async () => {
    seedTelemedicineConsultation();
    const patient = { role: 'patient', sub: ids.patientUser };
    const doctor = { role: 'doctor', sub: ids.doctorUser };
    const patientRequest = { ...req, user: patient };

    const initiated = await consultations.callAction(
      ids.consultation,
      { action: 'initiate' },
      patient,
      patientRequest,
    );

    expect(initiated).toMatchObject({
      consultation_id: ids.consultation,
      type: 'video',
      status: 'ringing',
      recipient_online: false,
    });
    expect(mockDb.collection('consultation_calls').documents[0]).toMatchObject({
      caller_user_id: ids.patientUser,
      recipient_user_id: ids.doctorUser,
      participants_user_ids: [ids.patientUser, ids.doctorUser],
      accepted_at: null,
      duration_seconds: null,
    });
    expect(mockDb.collection('consultations').documents[0].status).toBe('waiting');

    await expect(
      consultations.callAction(
        ids.consultation,
        { action: 'accept', call_id: initiated.id },
        patient,
        patientRequest,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

    const accepted = await consultations.callAction(
      ids.consultation,
      { action: 'accept', call_id: initiated.id },
      doctor,
      { ...req, user: doctor },
    );
    expect(accepted.status).toBe('accepted');
    expect(mockDb.collection('consultation_calls').documents[0].accepted_at).toBeInstanceOf(Date);
  });

  it('rejects call initiation without consent and marks unanswered calls missed only after timeout', async () => {
    seedTelemedicineConsultation();
    mockDb.collection('patient_consents').documents.length = 0;
    await expect(
      consultations.callAction(
        ids.consultation,
        { action: 'initiate' },
        { role: 'patient', sub: ids.patientUser },
        { ...req, user: { sub: ids.patientUser } },
      ),
    ).rejects.toMatchObject({ status: 422, code: 'TELECONSULTATION_CONSENT_REQUIRED' });
    expect(mockDb.collection('consultation_calls').documents).toHaveLength(0);

    seed('patient_consents', {
      patient_id: ids.patient,
      consent_type: 'teleconsultation',
      granted: true,
    });
    const initiated = await consultations.callAction(
      ids.consultation,
      { action: 'initiate' },
      { role: 'patient', sub: ids.patientUser },
      { ...req, user: { sub: ids.patientUser } },
    );
    const call = mockDb.collection('consultation_calls').documents[0];
    call.initiated_at = new Date(Date.now() - 46_000);
    const missed = await consultations.callAction(
      ids.consultation,
      { action: 'missed', call_id: initiated.id },
      { role: 'patient', sub: ids.patientUser },
      { ...req, user: { sub: ids.patientUser } },
    );
    expect(missed.status).toBe('missed');
    expect(mockDb.collection('consultations').documents[0].status).toBe('missed');
  });

  it('records elapsed call duration and completes a consultation when its doctor ends the call', async () => {
    seedTelemedicineConsultation('in_progress');
    const call = {
      id: ids.consultation,
      consultation_id: ids.consultation,
      status: 'accepted',
      type: 'audio',
      caller_user_id: ids.doctorUser,
      recipient_user_id: ids.patientUser,
      connected_at: new Date(Date.now() - 5_000),
      participants: [],
    };
    seed('consultation_calls', call);

    const ended = await consultations.callAction(
      ids.consultation,
      { action: 'end', call_id: call.id },
      { role: 'doctor', sub: ids.doctorUser },
      req,
    );

    expect(ended.status).toBe('ended');
    expect(ended.duration_seconds).toBeGreaterThanOrEqual(4);
    expect(mockDb.collection('consultations').documents[0]).toMatchObject({
      status: 'completed',
      duration_seconds: expect.any(Number),
    });
  });

  it('keeps consultation details and clinical notes private to authorized participants', async () => {
    seedTelemedicineConsultation();
    seed('consultation_notes', {
      id: ids.reminder,
      consultation_id: ids.consultation,
      author_id: ids.doctorUser,
      note: 'Follow up with the assigned clinician.',
      created_at: new Date(),
    });

    await expect(
      consultations.getById(ids.consultation, { role: 'patient', sub: ids.patientUser }),
    ).resolves.toMatchObject({
      patient_name: 'Synthetic Patient',
      notes: [{ note: 'Follow up with the assigned clinician.' }],
    });
    await expect(
      consultations.getById(ids.consultation, {
        role: 'patient',
        sub: 'b6b33580-1c35-4ae3-bf49-1f35532fd3ce',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('returns configured availability and online presence only for active non-demo doctors', async () => {
    mockDb.collection('users').documents.find(({ id }) => id === ids.doctorUser).full_name = 'Provider';
    mockDb.collection('doctors').documents.find(({ id }) => id === ids.doctor).availability = {
      '1': ['09:00'],
    };
    seed('doctors', {
      id: 'b6b33580-1c35-4ae3-bf49-1f35532fd3ce',
      user_id: 'b7b33580-1c35-4ae3-bf49-1f35532fd3ce',
      is_demo: true,
      availability: { '1': ['10:00'] },
    });
    seed('users', {
      id: 'b7b33580-1c35-4ae3-bf49-1f35532fd3ce',
      role: 'doctor',
      is_active: true,
      deleted_at: null,
    });
    seed('user_presence', {
      user_id: ids.doctorUser,
      expires_at: new Date(Date.now() + 30_000),
    });

    const result = await consultations.list(
      { availability: 'true' },
      { role: 'patient', sub: ids.patientUser },
    );

    expect(result.availability).toHaveLength(1);
    expect(result.availability[0]).toMatchObject({
      id: ids.doctor,
      full_name: 'Provider',
      availability: { '1': ['09:00'] },
      online_status: 'online',
    });
  });

  it('requires a private Jitsi deployment and participant JWTs in production', () => {
    const original = {
      nodeEnv: process.env.NODE_ENV,
      domain: process.env.VIDEO_DOMAIN,
      appId: process.env.VIDEO_APP_ID,
      secret: process.env.VIDEO_JWT_SECRET,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.VIDEO_DOMAIN = 'meet.jit.si';
      process.env.VIDEO_APP_ID = 'aarogya-production';
      process.env.VIDEO_JWT_SECRET = 'test-secret';
      expect(videoAdapter.isConfigured()).toBe(false);
      process.env.VIDEO_DOMAIN = 'MEET.JIT.SI';
      expect(videoAdapter.isConfigured()).toBe(false);

      process.env.VIDEO_DOMAIN = 'video.example.test';
      expect(videoAdapter.isConfigured()).toBe(true);

      delete process.env.VIDEO_JWT_SECRET;
      expect(videoAdapter.isConfigured()).toBe(false);
    } finally {
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
      if (original.domain === undefined) delete process.env.VIDEO_DOMAIN;
      else process.env.VIDEO_DOMAIN = original.domain;
      if (original.appId === undefined) delete process.env.VIDEO_APP_ID;
      else process.env.VIDEO_APP_ID = original.appId;
      if (original.secret === undefined) delete process.env.VIDEO_JWT_SECRET;
      else process.env.VIDEO_JWT_SECRET = original.secret;
    }
  });

  it('does not prepare a consultation on public Jitsi in production', async () => {
    const original = {
      nodeEnv: process.env.NODE_ENV,
      domain: process.env.VIDEO_DOMAIN,
      appId: process.env.VIDEO_APP_ID,
      secret: process.env.VIDEO_JWT_SECRET,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.VIDEO_DOMAIN = 'meet.jit.si';
      process.env.VIDEO_APP_ID = 'aarogya-production';
      process.env.VIDEO_JWT_SECRET = 'test-secret';
      seed('appointments', {
        id: ids.appointment,
        patient_id: ids.patient,
        doctor_id: ids.doctor,
        scheduled_at: new Date(Date.now() + 5 * 60 * 60 * 1000),
        status: 'confirmed',
        mode: 'video',
        deleted_at: null,
      });
      seed('patient_consents', {
        patient_id: ids.patient,
        consent_type: 'teleconsultation',
        granted: true,
      });

      await expect(
        consultations.create(
          { action: 'schedule', appointment_id: ids.appointment },
          { role: 'patient', sub: ids.patientUser },
          req,
        ),
      ).rejects.toMatchObject({ status: 503, code: 'VIDEO_PROVIDER_UNAVAILABLE' });
      expect(mockDb.collection('consultations').documents).toHaveLength(0);
    } finally {
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
      if (original.domain === undefined) delete process.env.VIDEO_DOMAIN;
      else process.env.VIDEO_DOMAIN = original.domain;
      if (original.appId === undefined) delete process.env.VIDEO_APP_ID;
      else process.env.VIDEO_APP_ID = original.appId;
      if (original.secret === undefined) delete process.env.VIDEO_JWT_SECRET;
      else process.env.VIDEO_JWT_SECRET = original.secret;
    }
  });

  it('requires teleconsultation consent and schedules a video room when granted', async () => {
    const appointment = {
      id: ids.appointment,
      patient_id: ids.patient,
      doctor_id: ids.doctor,
      scheduled_at: new Date(Date.now() + 5 * 60 * 60 * 1000),
      status: 'confirmed',
      mode: 'video',
      deleted_at: null,
    };
    seed('appointments', appointment);
    await expect(
      consultations.create(
        { action: 'schedule', appointment_id: ids.appointment },
        {
          role: 'patient',
          sub: ids.patientUser,
        },
        req,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'TELECONSULTATION_CONSENT_REQUIRED' });
    seed('patient_consents', {
      patient_id: ids.patient,
      consent_type: 'teleconsultation',
      granted: true,
    });
    const result = await consultations.create(
      { action: 'schedule', appointment_id: ids.appointment },
      {
        role: 'patient',
        sub: ids.patientUser,
      },
      req,
    );
    expect(result).toMatchObject({ status: 'scheduled', consultation_id: expect.any(String) });
    expect(result).not.toHaveProperty('join');
    expect(mockDb.collection('consultations').documents[0].id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mockDb.collection('notifications').documents).toHaveLength(2);
    expect(mockDb.collection('audit_logs').documents[0].action).toBe('consultation.schedule');

    delete process.env.VIDEO_JWT_SECRET;
    const repeatedSchedule = await consultations.create(
      { action: 'schedule', appointment_id: ids.appointment },
      {
        role: 'patient',
        sub: ids.patientUser,
      },
      req,
    );
    expect(repeatedSchedule).toMatchObject({
      consultation_id: result.consultation_id,
      status: 'scheduled',
    });
  });

  it('lets participants rejoin an in-progress call during the appointment window', async () => {
    const scheduledAt = new Date(Date.now() - 5 * 60 * 1000);
    seed('appointments', {
      id: ids.appointment,
      patient_id: ids.patient,
      doctor_id: ids.doctor,
      scheduled_at: scheduledAt,
      status: 'confirmed',
      mode: 'audio',
    });
    seed('consultations', {
      id: 'consultation-in-progress',
      appointment_id: ids.appointment,
      patient_id: ids.patient,
      doctor_id: ids.doctor,
      status: 'in_progress',
      provider: 'jitsi',
      provider_room_id: 'aarogya-test-room',
    });
    seed('patient_consents', {
      patient_id: ids.patient,
      consent_type: 'teleconsultation',
      granted: true,
    });

    const result = await consultations.list({}, { role: 'doctor', sub: ids.doctorUser });

    expect(result.items[0]).toMatchObject({
      join_available: true,
      teleconsultation_consent_granted: true,
      call_window_open: true,
    });
    expect(result.items[0]).not.toHaveProperty('join');
    delete process.env.VIDEO_JWT_SECRET;
    const join = await consultations.create(
      {
        action: 'join',
        consultation_id: 'consultation-in-progress',
      },
      { role: 'doctor', sub: ids.doctorUser },
      req,
    );
    expect(join.join).toMatchObject({
      provider: 'jitsi',
      room: 'aarogya-test-room',
      token: null,
      display_name: 'Doctor',
      audio_only: true,
    });
    expect(join.join.expires_in_seconds).toBeGreaterThan(55 * 60);
    expect(join.join.expires_in_seconds).toBeLessThan(56 * 60);
  });

  it('exposes WebRTC eligibility without a legacy Jitsi room or provider configuration', async () => {
    seedTelemedicineConsultation();
    const original = {
      nodeEnv: process.env.NODE_ENV,
      domain: process.env.VIDEO_DOMAIN,
      appId: process.env.VIDEO_APP_ID,
      secret: process.env.VIDEO_JWT_SECRET,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.VIDEO_DOMAIN = 'video.example.test';
      process.env.VIDEO_APP_ID = 'native-services-production';
      delete process.env.VIDEO_JWT_SECRET;
      const result = await consultations.list({}, { role: 'doctor', sub: ids.doctorUser });

      expect(result.items[0]).toMatchObject({
        join_available: true,
        teleconsultation_consent_granted: true,
        call_window_open: true,
      });
      expect(result.provider_configured).toBe(false);
    } finally {
      for (const [key, value] of Object.entries({
        NODE_ENV: original.nodeEnv,
        VIDEO_DOMAIN: original.domain,
        VIDEO_APP_ID: original.appId,
        VIDEO_JWT_SECRET: original.secret,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('withholds join credentials outside the appointment window or without consent', async () => {
    seed('appointments', {
      id: ids.appointment,
      patient_id: ids.patient,
      doctor_id: ids.doctor,
      scheduled_at: new Date(Date.now() + 60_000),
      status: 'confirmed',
      mode: 'video',
    });
    seed('consultations', {
      id: 'consultation-join-guard',
      appointment_id: ids.appointment,
      patient_id: ids.patient,
      doctor_id: ids.doctor,
      status: 'scheduled',
      provider: 'jitsi',
      provider_room_id: 'aarogya-test-room',
    });
    const joinInput = { action: 'join', consultation_id: 'consultation-join-guard' };
    const doctor = { role: 'doctor', sub: ids.doctorUser };

    await expect(consultations.create(joinInput, doctor, req)).rejects.toMatchObject({
      status: 422,
      code: 'TELECONSULTATION_CONSENT_REQUIRED',
    });
    seed('patient_consents', {
      patient_id: ids.patient,
      consent_type: 'teleconsultation',
      granted: true,
    });
    await mockDb
      .collection('appointments')
      .updateOne(
        { id: ids.appointment },
        { $set: { scheduled_at: new Date(Date.now() + 5 * 60 * 60 * 1000) } },
      );
    await expect(consultations.create(joinInput, doctor, req)).rejects.toMatchObject({
      status: 422,
      code: 'CONSULTATION_OUTSIDE_WINDOW',
    });
  });

  it('creates medicines, schedules reminder logs, and enforces dose recording access', async () => {
    const doctorUser = { role: 'doctor', sub: ids.doctorUser };
    const created = await medicines.createMedicine(
      {
        patient_id: ids.patient,
        name: 'Synthetic medicine',
        dosage: '1 tablet',
        form: 'tablet',
        instructions: '',
      },
      doctorUser,
      req,
    );
    const medicine = created.data.medicine;
    expect(medicine.id).toMatch(/^[0-9a-f-]{36}$/i);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(tomorrow);
    const reminderResult = await medicines.createReminder(
      {
        medicine_id: medicine.id,
        frequency: 'once_daily',
        reminder_times: ['09:00'],
        start_date: startDate,
        channel: 'in_app',
      },
      doctorUser,
      req,
    );
    const reminder = reminderResult.data.reminder;
    expect(mockDb.collection('medication_logs').documents.length).toBeGreaterThan(0);
    const dose = mockDb.collection('medication_logs').documents[0];
    const logInput = {
      reminder_id: reminder.id,
      scheduled_for: dose.scheduled_for.toISOString(),
      status: 'taken',
      notes: '',
    };
    await expect(
      medicines.createLog(logInput, { role: 'patient', sub: ids.doctorUser }, req),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    const recorded = await medicines.createLog(logInput, doctorUser, req);
    expect(recorded.data.log).toMatchObject({ status: 'taken', reminder_id: reminder.id });
  });

  it('creates contacts and sends consented SOS alerts through Mongo records', async () => {
    const patientUser = { role: 'patient', sub: ids.patientUser };
    const contactResult = await emergency.addContact(
      {
        name: 'Emergency contact',
        relationship: 'Family',
        mobile: '+919000000000',
        is_primary: true,
      },
      patientUser,
      req,
    );
    const contactId = contactResult.data.contact.id;
    seed('hospitals', {
      id: 'test-hospital',
      name: 'Test Hospital',
      district: 'Test District',
      mobile: '9000000000',
      emergency_phone: '108',
      is_active: true,
    });
    const result = await emergency.sendSos(
      {
        location_consent: true,
        latitude: 17.4,
        longitude: 78.4,
        contact_ids: [contactId],
        notes: 'Synthetic emergency',
      },
      patientUser,
      req,
    );
    expect(result.data.request).toMatchObject({
      patient_id: ids.patient,
      location_consent: true,
      location_shared: true,
      status: 'open',
    });
    expect(result.data.request).not.toHaveProperty('lat');
    expect(mockDb.collection('emergency_requests').documents).toHaveLength(1);
    expect(mockDb.collection('notifications').documents).toHaveLength(1);
    expect(smsAdapter.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+919000000000',
        idempotencyKey: expect.stringContaining('aarogya-sos-'),
      }),
    );
    expect(result.data.contacts_delivery).toEqual([{ contact_id: contactId, delivered: true }]);
  });
});
