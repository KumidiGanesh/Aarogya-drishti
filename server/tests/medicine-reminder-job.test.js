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
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === '$in') return value.includes(actual);
        if (operator === '$gte') return new Date(actual) >= new Date(value);
        if (operator === '$gt') return new Date(actual) > new Date(value);
        if (operator === '$lte') return new Date(actual) <= new Date(value);
        if (operator === '$lt') return new Date(actual) < new Date(value);
        return false;
      });
    }
    return actual === expected;
  });
}

function createCollection() {
  const documents = [];
  return {
    documents,
    find: jest.fn((filter) => {
      let found = documents.filter((item) => matches(item, filter));
      const cursor = {
        sort: (sort) => {
          const [[field, direction]] = Object.entries(sort);
          found = found.sort((left, right) => (left[field] > right[field] ? 1 : left[field] < right[field] ? -1 : 0) * direction);
          return cursor;
        },
        toArray: async () => found,
      };
      return cursor;
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
  };
}

jest.mock('../src/db/mongo', () => ({ getDb: jest.fn(async () => mockDb) }));
jest.mock('../src/services/notificationService', () => ({ create: jest.fn() }));

const { dispatchMedicineReminders } = require('../src/jobs/medicineReminderJob');
const notificationService = require('../src/services/notificationService');

describe('medicine reminder scheduler', () => {
  beforeEach(() => {
    mockCollections.clear();
    jest.clearAllMocks();
  });

  it('writes one in-app reminder for a due dose across repeated scheduler runs', async () => {
    const now = new Date();
    const scheduledFor = new Date(now.getTime() - 15000);
    const patientId = 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce';
    const reminderId = 'f4b33580-1c35-4ae3-bf49-1f35532fd3ce';
    const medicineId = 'e4b33580-1c35-4ae3-bf49-1f35532fd3ce';
    const userId = '7c31cbd1-ef65-4e8d-a526-c90dfb51192d';
    const dose = {
      id: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
      scheduled_for: scheduledFor,
      status: 'pending',
      sent_at: null,
      reminder_id: reminderId,
    };
    mockDb.collection('medicine_reminders').documents.push({
      id: reminderId,
      patient_id: patientId,
      medicine_id: medicineId,
      channel: 'in_app',
      is_active: true,
      generated_until: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(now.getTime() + 6 * 86400000)),
      starts_at: new Date(now.getTime() - 86400000),
      ends_at: null,
      reminder_times: ['09:00'],
    });
    mockDb.collection('patients').documents.push({
      id: patientId,
      user_id: userId,
      is_active: true,
      preferred_language: 'en',
    });
    mockDb.collection('medicines').documents.push({ id: medicineId, name: 'Synthetic medicine' });
    mockDb.collection('users').documents.push({ id: userId, preferred_language: 'en' });
    mockDb.collection('medication_logs').documents.push(dose);

    await dispatchMedicineReminders(now);
    await dispatchMedicineReminders(now);

    expect(notificationService.create).toHaveBeenCalledTimes(1);
    expect(notificationService.create).toHaveBeenCalledWith(
      mockDb,
      userId,
      'medicine',
      { medication_log_id: dose.id, reminder_id: reminderId },
      expect.objectContaining({ idempotencyKey: `aarogya-medicine-${dose.id}` }),
    );
    expect(dose.sent_at).toEqual(now);
    expect(mockDb.collection('medication_logs').updateOne).toHaveBeenCalledWith(
      { id: dose.id, status: 'pending', sent_at: null },
      { $set: { sent_at: now, updated_at: now } },
    );
  });
});
