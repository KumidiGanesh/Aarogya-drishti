const { v5: uuidv5 } = require('uuid');
const {
  FACILITY_NAMES,
  HOSPITAL_NAMES,
} = require('../facilities/catalog');

const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const demoUserId = (index) => uuidv5(`aarogya-demo:user:doctor:${index}`, NAMESPACE);
const demoDoctorId = (index) => uuidv5(`aarogya-demo:doctor:${index}`, NAMESPACE);
const demoSlots = ['09:00', '10:00', '11:00'];
const availability = Object.fromEntries(
  Array.from({ length: 7 }, (_value, day) => [String(day), demoSlots]),
);

async function seedDemoAppointmentDoctors(db, now = new Date()) {
  const seededDoctors = [];
  for (let index = 0; index < 5; index += 1) {
    const userId = demoUserId(index);
    const user = await db.collection('users').findOne({
      id: userId,
      role: 'doctor',
      is_active: true,
    });
    if (!user || !user.email?.endsWith('@demo.example.test')) {
      throw new Error('Run the development demo seed before seeding appointment demo doctors');
    }

    const facilityName = FACILITY_NAMES[index];
    const facilityType = HOSPITAL_NAMES.includes(facilityName) ? 'hospital' : 'phc';
    const facility = await db.collection(facilityType === 'hospital' ? 'hospitals' : 'phcs')
      .findOne({ name: facilityName, is_active: true });
    if (!facility) {
      throw new Error(`Seed the facility directory before assigning demo doctors: ${facilityName}`);
    }

    const doctor = {
      id: demoDoctorId(index),
      user_id: userId,
      registration_number: `DEMO-DOC-${String(index + 1).padStart(3, '0')}`,
      qualification: 'Synthetic demonstration qualification',
      specialty: 'Demo dentistry',
      availability,
      is_demo: true,
      updated_at: now,
      ...(facilityType === 'hospital'
        ? { hospital_id: facility.id }
        : { phc_id: facility.id }),
    };
    const otherFacilityField = facilityType === 'hospital' ? 'phc_id' : 'hospital_id';
    await db.collection('doctors').updateOne(
      { user_id: userId },
      {
        $set: doctor,
        $unset: { [otherFacilityField]: '' },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
    seededDoctors.push(doctor);
  }
  return seededDoctors;
}

module.exports = { seedDemoAppointmentDoctors };
