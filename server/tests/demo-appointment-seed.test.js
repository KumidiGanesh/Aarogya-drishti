const {
  FACILITY_NAMES,
  HOSPITAL_NAMES,
} = require('../src/facilities/catalog');
const { seedDemoAppointmentDoctors } = require('../src/db/demoAppointmentSeed');

function createDb() {
  const collections = new Map();
  return {
    collection(name) {
      if (!collections.has(name)) {
        const documents = [];
        collections.set(name, {
          documents,
          findOne: jest.fn(async (filter) =>
            documents.find((document) =>
              Object.entries(filter).every(([key, value]) => document[key] === value),
            ) || null),
          updateOne: jest.fn(async (filter, update) => {
            let document = documents.find((item) =>
              Object.entries(filter).every(([key, value]) => item[key] === value),
            );
            if (!document) {
              document = { ...filter, ...(update.$setOnInsert || {}) };
              documents.push(document);
            }
            Object.assign(document, update.$set || {});
            for (const key of Object.keys(update.$unset || {})) delete document[key];
            return { matchedCount: 1, modifiedCount: 1 };
          }),
        });
      }
      return collections.get(name);
    },
  };
}

describe('development appointment demo seed', () => {
  it('assigns five synthetic doctors to only five supplied facilities with sample schedules', async () => {
    const db = createDb();
    for (let index = 0; index < 5; index += 1) {
      db.collection('users').documents.push({
        id: require('uuid').v5(
          `aarogya-demo:user:doctor:${index}`,
          '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        ),
        role: 'doctor',
        is_active: true,
        email: `doctor${index + 1}@demo.example.test`,
      });
      const name = FACILITY_NAMES[index];
      db.collection(HOSPITAL_NAMES.includes(name) ? 'hospitals' : 'phcs')
        .documents.push({ id: `facility-${index}`, name, is_active: true });
    }

    const doctors = await seedDemoAppointmentDoctors(db);
    const doctorRecords = db.collection('doctors').documents;
    const assignments = doctorRecords.map((record) => record.hospital_id || record.phc_id);

    expect(doctors).toHaveLength(5);
    expect(doctorRecords).toHaveLength(5);
    expect(doctorRecords.every((record) => record.is_demo && record.specialty === 'Demo dentistry')).toBe(true);
    expect(assignments).toEqual(FACILITY_NAMES.slice(0, 5).map((_name, index) => `facility-${index}`));
    expect(doctorRecords.every((record) => Object.keys(record.availability).length === 7)).toBe(true);

    await seedDemoAppointmentDoctors(db);
    expect(db.collection('doctors').documents).toHaveLength(5);
  });

  it('refuses to assign a clinician that is not a development demo account', async () => {
    const db = createDb();
    await expect(seedDemoAppointmentDoctors(db)).rejects.toThrow(
      'Run the development demo seed before seeding appointment demo doctors',
    );
    expect(db.collection('doctors').documents).toHaveLength(0);
  });
});
