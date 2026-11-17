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
        if (operator === '$ne') return actual !== value;
        if (operator === '$gte') return new Date(actual) >= new Date(value);
        if (operator === '$gt') return new Date(actual) > new Date(value);
        if (operator === '$lte') return new Date(actual) <= new Date(value);
        if (operator === '$lt') return new Date(actual) < new Date(value);
        return false;
      });
    }
    if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
    return actual === expected;
  });
}

function createCollection() {
  const documents = [];
  const collection = {
    documents,
    createIndex: jest.fn(async () => 'idx_appointments_active_doctor_slot'),
    findOne: jest.fn(async (filter) => documents.find((item) => matches(item, filter)) || null),
    find: jest.fn((filter) => {
      let found = documents.filter((item) => matches(item, filter));
      const cursor = {
        sort: (sort) => {
          const [[field, direction]] = Object.entries(sort);
          found = found.sort((left, right) => (left[field] > right[field] ? 1 : left[field] < right[field] ? -1 : 0) * direction);
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
      if (document.id && documents.some((item) => item.id === document.id)) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      documents.push(document);
      return { insertedId: document.id };
    }),
    updateOne: jest.fn(async (filter, update) => {
      const found = documents.find((item) => matches(item, filter));
      if (found) {
        Object.assign(found, update.$set || {});
        Object.keys(update.$unset || {}).forEach((key) => delete found[key]);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (update.$setOnInsert) {
        documents.push({ ...filter, ...update.$setOnInsert, ...update.$set });
      }
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
      Object.keys(update.$unset || {}).forEach((key) => delete found[key]);
      return found;
    }),
    countDocuments: jest.fn(async (filter) => documents.filter((item) => matches(item, filter)).length),
  };
  return collection;
}

jest.mock('../src/db/mongo', () => ({ getDb: jest.fn(async () => mockDb) }));

const service = require('../src/appointments/service');
const { v5: uuidv5 } = require('uuid');
const {
  FACILITY_NAMES,
  HOSPITAL_NAMES,
  CHC_NAME,
  PRIMARY_CARE_NAMES,
} = require('../src/facilities/catalog');
const { seedFacilityDirectory } = require('../src/db/facilityDirectorySeed');

const patientId = 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const doctorId = 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const facilityId = 'e4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const userId = 'f4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const appointmentId = 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce';

function nextWeekday(weekday, weeks = 2) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + weeks * 7);
  value.setUTCHours(0, 0, 0, 0);
  while (value.getUTCDay() !== weekday) value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function createInput() {
  return {
    patient_id: patientId,
    doctor_id: doctorId,
    hospital_id: facilityId,
    appointment_date: nextWeekday(1),
    time_slot: '09:00',
    mode: 'in_person',
    reason: 'Synthetic appointment',
  };
}

const patient = { id: patientId, user_id: userId, is_active: true, deleted_at: null };
const doctor = {
  id: doctorId,
  user_id: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  hospital_id: facilityId,
  availability: { '1': ['09:00'] },
};
const req = { user: { sub: userId, role: 'patient' }, ip: '127.0.0.1', get: () => 'appointments-test' };

function seed(name, ...documents) {
  mockDb.collection(name).documents.push(...documents);
}

beforeEach(() => {
  mockCollections.clear();
  seed('patients', patient);
  seed('doctors', { ...doctor });
  seed('users',
    { id: userId, preferred_language: 'en', is_active: true },
    { id: doctor.user_id, preferred_language: 'en', is_active: true },
  );
  seed('hospitals', { id: facilityId, is_active: true, name: 'AREA HOSPITAL - ARAKU' });
  seed('phcs', { id: doctor.phc_id, is_active: true, name: 'ANANTHAGIRI', facility_type: 'phc' });
});

describe('Mongo-backed appointment persistence', () => {
  it('seeds the allowed directory idempotently and retires only legacy demo facilities', async () => {
    const appointmentHistory = {
      id: appointmentId,
      facility_type: 'hospital',
      facility_id: 'historical-facility-id',
    };
    seed('appointments', appointmentHistory);
    seed('hospitals', {
      id: uuidv5(
        'aarogya-demo:hospital:3',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      ),
      name: 'Demonstration Hospital 1',
      is_active: true,
    });

    await seedFacilityDirectory(mockDb);
    await seedFacilityDirectory(mockDb);

    const activeHospitals = mockDb.collection('hospitals').documents.filter(({ is_active }) => is_active);
    const activePhcs = mockDb.collection('phcs').documents.filter(({ is_active }) => is_active);
    expect(activeHospitals.map(({ name }) => name).sort()).toEqual(HOSPITAL_NAMES.slice().sort());
    expect(activePhcs.map(({ name }) => name).sort()).toEqual(
      FACILITY_NAMES.filter((name) => !HOSPITAL_NAMES.includes(name)).sort(),
    );
    expect(mockDb.collection('phcs').documents).toHaveLength(PRIMARY_CARE_NAMES.length);
    expect(new Set(activeHospitals.map(({ hospital_code }) => hospital_code)).size).toBe(HOSPITAL_NAMES.length);
    expect(activeHospitals.every(({ hospital_code }) => hospital_code)).toBe(true);
    expect(new Set(activePhcs.map(({ phc_code }) => phc_code)).size).toBe(activePhcs.length);
    expect(activePhcs.every(({ phc_code }) => phc_code)).toBe(true);
    expect(mockDb.collection('hospitals').documents).toContainEqual(expect.objectContaining({
      name: 'Demonstration Hospital 1',
      is_active: false,
    }));
    expect(mockDb.collection('appointments').documents).toContain(appointmentHistory);
  });

  it('returns exactly the 38 supplied facility names in their supplied order', async () => {
    mockDb.collection('hospitals').documents.length = 0;
    mockDb.collection('phcs').documents.length = 0;
    for (const [index, name] of FACILITY_NAMES.entries()) {
      const record = {
        id: `facility-${index}`,
        name,
        is_active: true,
        ...(name === CHC_NAME ? { facility_type: 'chc' } : {}),
      };
      seed(HOSPITAL_NAMES.includes(name) ? 'hospitals' : 'phcs', record);
    }

    const result = await service.listAppointments({ directory: 'true' }, req.user);
    const listedNames = result.directory.facilities.map(({ name }) => name);

    expect(listedNames).toEqual(FACILITY_NAMES);
    expect(listedNames).toHaveLength(FACILITY_NAMES.length);
    expect(new Set(listedNames).size).toBe(FACILITY_NAMES.length);
    expect(listedNames.some((name) => /demo|demonstration/i.test(name))).toBe(false);
    expect(result.directory.facilities[2]).toMatchObject({
      name: CHC_NAME,
      facility_type: 'chc',
    });
  });

  it('does not expose active facilities outside the supplied list', async () => {
    seed('hospitals', {
      id: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
      is_active: true,
      name: 'Demonstration Hospital 1',
    });

    const result = await service.listAppointments({ directory: 'true' }, req.user);

    expect(result.directory.facilities.map(({ name }) => name)).not.toContain('Demonstration Hospital 1');
  });

  it('creates appointments with string UUIDs and writes notifications and audit records', async () => {
    const result = await service.createAppointment(createInput(), req.user, req);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.status).toBe('booked');
    expect(mockDb.collection('appointments').documents).toHaveLength(1);
    expect(mockDb.collection('appointments').createIndex).toHaveBeenCalledWith(
      { doctor_id: 1, scheduled_at: 1 },
      expect.objectContaining({ unique: true }),
    );
    expect(mockDb.collection('notifications').documents).toHaveLength(2);
    expect(mockDb.collection('notifications').documents.every(({ body }) =>
      body.includes('awaiting facility confirmation'))).toBe(true);
    expect(mockDb.collection('audit_logs').documents[0]).toMatchObject({
      action: 'appointment.created',
      entity: 'appointment',
      entity_id: result.id,
    });
  });

  it('shows a patient booking first in the assigned doctor’s upcoming appointments', async () => {
    mockDb.collection('patients').documents[0].full_name = 'Synthetic Patient';
    const booking = await service.createAppointment(createInput(), req.user, req);
    seed('appointments', {
      id: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
      patient_id: patientId,
      doctor_id: doctorId,
      facility_type: 'hospital',
      facility_id: facilityId,
      scheduled_at: service.appointmentInstant(nextWeekday(1, 3), '09:00'),
      time_slot: '09:00',
      status: 'booked',
      deleted_at: null,
    });

    const result = await service.listAppointments(
      { upcoming: 'true', page: '1', limit: '1' },
      { sub: doctor.user_id, role: 'doctor' },
    );

    expect(result.items[0]).toMatchObject({
      id: booking.id,
      patient_name: 'Synthetic Patient',
      status: 'booked',
    });
  });

  it('keeps new requests pending until an assigned doctor confirms them', async () => {
    const created = await service.createAppointment(createInput(), req.user, req);
    const doctorRequest = {
      ...req,
      user: { sub: doctor.user_id, role: 'doctor' },
    };

    await expect(service.updateAppointment(
      created.id,
      { action: 'confirm' },
      req.user,
      req,
    )).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(mockDb.collection('appointments').documents[0].status).toBe('booked');

    const confirmed = await service.updateAppointment(
      created.id,
      { action: 'confirm' },
      doctorRequest.user,
      doctorRequest,
    );
    expect(confirmed.appointment).toMatchObject({
      status: 'confirmed',
      confirmed_by: doctor.user_id,
    });
    expect(confirmed.appointment.confirmed_at).toBeInstanceOf(Date);
  });

  it('rejects unknown and inactive facility identifiers', async () => {
    const unknownFacility = {
      ...createInput(),
      hospital_id: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
    };
    await expect(service.createAppointment(unknownFacility, req.user, req)).rejects.toMatchObject({
      status: 404,
      code: 'FACILITY_NOT_FOUND',
    });

    mockDb.collection('hospitals').documents[0].is_active = false;
    await expect(service.createAppointment(createInput(), req.user, req)).rejects.toMatchObject({
      status: 404,
      code: 'FACILITY_NOT_FOUND',
    });
  });

  it('returns a rescheduled appointment to pending confirmation', async () => {
    const appointment = {
      id: appointmentId,
      patient_id: patientId,
      doctor_id: doctorId,
      facility_type: 'hospital',
      facility_id: facilityId,
      scheduled_at: service.appointmentInstant(nextWeekday(1), '09:00'),
      time_slot: '09:00',
      status: 'confirmed',
      confirmed_at: new Date(),
      confirmed_by: doctor.user_id,
      deleted_at: null,
    };
    seed('appointments', appointment);

    const updated = await service.updateAppointment(
      appointmentId,
      { action: 'reschedule', appointment_date: nextWeekday(1, 3), time_slot: '09:00' },
      req.user,
      req,
    );

    expect(updated.appointment.status).toBe('booked');
    expect(updated.appointment).not.toHaveProperty('confirmed_at');
    expect(updated.appointment).not.toHaveProperty('confirmed_by');
  });

  it('rejects appointment creation for an active but unlisted hospital', async () => {
    const invalidFacilityId = 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce';
    seed('hospitals', {
      id: invalidFacilityId,
      is_active: true,
      name: 'Demonstration Hospital 1',
    });
    const input = { ...createInput(), hospital_id: invalidFacilityId };

    await expect(service.createAppointment(input, req.user, req)).rejects.toMatchObject({
      status: 422,
      code: 'FACILITY_NOT_ALLOWED',
    });
    expect(mockDb.collection('appointments').documents).toHaveLength(0);
  });

  it('rejects a supplied facility when the selected doctor is not assigned to it', async () => {
    mockDb.collection('doctors').documents[0].hospital_id =
      'b4b33580-1c35-4ae3-bf49-1f35532fd3ce';

    await expect(service.createAppointment(createInput(), req.user, req)).rejects.toMatchObject({
      status: 422,
      code: 'DOCTOR_FACILITY_MISMATCH',
    });
    expect(mockDb.collection('appointments').documents).toHaveLength(0);
  });

  it('rejects an already occupied doctor slot', async () => {
    const input = createInput();
    mockDb.collection('appointments').documents.push({
      id: appointmentId,
      doctor_id: doctorId,
      scheduled_at: service.appointmentInstant(input.appointment_date, input.time_slot),
      status: 'confirmed',
      deleted_at: null,
    });
    await expect(service.createAppointment(input, req.user, req)).rejects.toMatchObject({
      status: 409,
      code: 'APPOINTMENT_SLOT_TAKEN',
    });
  });

  it('books at the selected assigned PHC and excludes the booked slot from availability', async () => {
    const input = createInput();
    delete input.hospital_id;
    input.phc_id = doctor.phc_id;
    const result = await service.createAppointment(input, req.user, req);
    expect(result.facility_type).toBe('phc');
    expect(result.facility_id).toBe(doctor.phc_id);

    const availability = await service.listAppointments({
      doctor_id: doctorId,
      phc_id: doctor.phc_id,
      appointment_date: input.appointment_date,
      limit: '1',
    }, req.user);
    expect(availability.available_slots).toEqual([]);
  });

  it('enforces health-worker assignment and patient ownership', async () => {
    await expect(service.createAppointment(createInput(), { role: 'patient', sub: doctor.user_id }, req))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(service.createAppointment(createInput(), { role: 'health_worker', sub: doctor.user_id }, req))
      .rejects.toMatchObject({ status: 403, code: 'OUTSIDE_ASSIGNED_AREA' });
  });

  it('cancels owned appointments and dispatches due reminders', async () => {
    const appointment = {
      id: appointmentId,
      patient_id: patientId,
      doctor_id: doctorId,
      patient_user_id: userId,
      doctor_user_id: doctor.user_id,
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000),
      status: 'confirmed',
      deleted_at: null,
    };
    seed('appointments', appointment);
    const updated = await service.updateAppointment(
      appointmentId,
      { action: 'cancel', reason: 'Schedule change' },
      req.user,
      req,
    );
    expect(updated.appointment.status).toBe('cancelled');

    appointment.status = 'confirmed';
    appointment.deleted_at = null;
    appointment.reminder_24h_sent_at = null;
    appointment.reminder_2h_sent_at = null;
    seed('user_settings', {
      user_id: userId,
      key: 'appointment_reminders',
      value: { enabled: true, reminders_24h: true, reminders_2h: true },
    });
    expect(await service.dispatchAppointmentReminders()).toBe(1);
    expect(mockDb.collection('notifications').documents.filter((item) => item.data?.reminder)).toHaveLength(2);
  });
});
