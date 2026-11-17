const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const collections = {};
const mockDb = {
  collection: jest.fn((name) => {
    if (!collections[name]) collections[name] = [];
    const records = collections[name];
    const matchesValue = (actual, expected) => {
      if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
        if ('$in' in expected && !expected.$in.includes(actual)) return false;
        if ('$gte' in expected && !(actual >= expected.$gte)) return false;
        if ('$lt' in expected && !(actual < expected.$lt)) return false;
        return true;
      }
      if (expected === null) return actual == null;
      return actual instanceof Date && expected instanceof Date
        ? actual.getTime() === expected.getTime()
        : actual === expected;
    };
    const matches = (record, filter = {}) => Object.entries(filter).every(([key, expected]) => {
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
      countDocuments: async (filter = {}) => records.filter((record) => matches(record, filter)).length,
      updateOne: async (filter, update) => {
        const record = records.find((item) => matches(item, filter));
        if (!record) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(record, update.$set || {});
        return { matchedCount: 1, modifiedCount: 1 };
      },
      deleteMany: async (filter) => {
        const remaining = records.filter((record) => !matches(record, filter));
        const deletedCount = records.length - remaining.length;
        collections[name] = remaining;
        return { deletedCount };
      },
    };
  }),
};

jest.mock('../src/db/mongo', () => ({ getDb: jest.fn(async () => mockDb) }));

const service = require('../src/referrals/service');
const storage = require('../src/adapters/privateImageStorage');

const ids = {
  patient: 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  specialist: 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  hospital: 'e4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  referral: 'f4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  user: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  patientUser: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
};
const user = { sub: ids.user, role: 'doctor' };
const req = { user, ip: '127.0.0.1', get: () => 'referrals-test' };
const storagePath = path.join(__dirname, '.referral-storage-test');

beforeEach(async () => {
  jest.clearAllMocks();
  for (const key of Object.keys(collections)) delete collections[key];
  collections.patients = [{
    id: ids.patient,
    user_id: ids.patientUser,
    patient_code: 'AD-2026-000001',
    full_name: 'Synthetic patient',
    is_active: true,
    deleted_at: null,
  }];
  collections.specialists = [{ id: ids.specialist, user_id: ids.specialist, specialty: 'Dental' }];
  collections.hospitals = [{ id: ids.hospital, name: 'Synthetic hospital', address: 'Synthetic address', is_active: true }];
  collections.users = [
    { id: ids.user, full_name: 'Synthetic doctor', preferred_language: 'en', is_active: true },
    { id: ids.specialist, full_name: 'Synthetic specialist', preferred_language: 'en', is_active: true },
    { id: ids.patientUser, full_name: 'Synthetic patient', preferred_language: 'en', is_active: true },
  ];
  collections.referrals = [];
  collections.referral_events = [];
  collections.referral_documents = [];
  collections.notifications = [];
  collections.audit_logs = [];
  await fs.rm(storagePath, { recursive: true, force: true });
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_PATH = storagePath;
  process.env.STORAGE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  process.env.STORAGE_ENCRYPTION_KEY_ID = 'referral-test-key';
});

afterEach(async () => {
  await fs.rm(storagePath, { recursive: true, force: true });
});

describe('referral supporting documents', () => {
  it('encrypts uploaded documents and returns bytes only after an authenticated round trip', async () => {
    const pdf = Buffer.from('%PDF-1.4 synthetic demo document');
    const result = await service.referralAction(
      {
        action: 'create',
        patient_id: ids.patient,
        specialist_id: ids.specialist,
        referral_hospital_id: ids.hospital,
        reason: 'Synthetic referral',
        urgency: 'routine',
      },
      [{ buffer: pdf, mimetype: 'application/pdf', originalname: 'sample.pdf', size: pdf.length }],
      user,
      req,
    );
    const document = collections.referral_documents[0];
    const saved = await fs.readFile(path.join(storagePath, `${document.storage_key}.enc`));
    expect(saved.includes(pdf)).toBe(false);
    expect(result.documents).toHaveLength(1);
    expect(await storage.decryptStoredImage(document)).toEqual(pdf);
    expect(collections.audit_logs[0]).toMatchObject({
      action: 'referral.created',
      entity: 'referral',
      entity_id: result.referral.id,
    });
  });

  it('rejects a content type that does not match the declared file type', () => {
    expect(() => service.fileType(Buffer.from('not pdf'), 'application/pdf'))
      .toThrow('Document content must match its PDF, JPEG, or PNG file type');
  });

  it('restricts referral status updates to the assigned specialist', async () => {
    collections.referrals.push({
      id: ids.referral,
      patient_id: ids.patient,
      referred_by: ids.user,
      referred_to_specialist_id: ids.specialist,
      status: 'pending',
      feedback: '',
    });
    const specialistRequest = { ...req, user: { sub: ids.specialist, role: 'specialist' } };
    await expect(service.referralAction(
      { action: 'update_status', referral_id: ids.referral, status: 'accepted', note: '' },
      [],
      { sub: ids.user, role: 'specialist' },
      specialistRequest,
    )).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    const result = await service.referralAction(
      { action: 'update_status', referral_id: ids.referral, status: 'accepted', note: 'Reviewed' },
      [],
      specialistRequest.user,
      specialistRequest,
    );
    expect(result.referral.status).toBe('accepted');
    expect(collections.referral_events[0]).toMatchObject({
      event_type: 'status_changed',
      details: { from: 'pending', to: 'accepted', note: 'Reviewed' },
    });
  });

  it('stores specialist feedback and doctor follow-ups in the referral timeline', async () => {
    collections.referrals.push({
      id: ids.referral,
      patient_id: ids.patient,
      referred_by: ids.user,
      referred_to_specialist_id: ids.specialist,
      status: 'accepted',
      feedback: '',
    });
    const specialistRequest = { ...req, user: { sub: ids.specialist, role: 'specialist' } };
    await service.referralAction(
      {
        action: 'specialist_feedback',
        referral_id: ids.referral,
        feedback: 'Synthetic feedback',
        recommended_investigations: ['Review'],
      },
      [],
      specialistRequest.user,
      specialistRequest,
    );
    expect(collections.referral_events[0]).toMatchObject({
      event_type: 'specialist_feedback',
      details: { recommended_investigations: ['Review'] },
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const followUpDate = tomorrow.toISOString().slice(0, 10);
    await service.referralAction(
      {
        action: 'follow_up',
        referral_id: ids.referral,
        follow_up_date: followUpDate,
        follow_up_status: 'scheduled',
        notes: 'Synthetic check-in',
      },
      [],
      user,
      req,
    );
    expect(collections.referral_events[1]).toMatchObject({
      event_type: 'follow_up',
      details: { follow_up_date: followUpDate, follow_up_status: 'scheduled' },
    });
    expect(collections.audit_logs.map((entry) => entry.action))
      .toEqual(['referral.specialist_feedback', 'referral.follow_up']);
  });

  it('filters referral records and returns stable paginated response metadata', async () => {
    const createdAt = new Date('2026-11-02T10:00:00.000Z');
    collections.referrals.push({
      id: ids.referral,
      patient_id: ids.patient,
      referred_by: ids.user,
      referred_to_specialist_id: ids.specialist,
      hospital_id: ids.hospital,
      status: 'pending',
      urgency: 'urgent',
      reason: 'Synthetic reason',
      feedback: '',
      created_at: createdAt,
      updated_at: createdAt,
    });
    const result = await service.listReferrals(
      { status: 'pending', page: '1', limit: '1' },
      user,
    );
    expect(result.items[0]).toMatchObject({
      id: ids.referral,
      patient_name: 'Synthetic patient',
      specialist_name: 'Synthetic specialist',
      hospital_name: 'Synthetic hospital',
      timeline: [],
      documents: [],
    });
    expect(result.meta).toMatchObject({ page: 1, limit: 1, total: 1, totalPages: 1 });
  });
});
