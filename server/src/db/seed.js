require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const bcrypt = require('bcrypt');
const { randomBytes, randomUUID } = require('node:crypto');
const { v5: uuidv5 } = require('uuid');
const logger = require('../utils/logger');
const { checkConnection, getDb, closeMongo } = require('./mongo');
const { seedFacilityDirectory } = require('./facilityDirectorySeed');
const {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_NAMES,
  ensurePermissionCatalog,
} = require('../auth/permissions');

const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const idFor = (key) => uuidv5(`aarogya-demo:${key}`, NAMESPACE);
const languageCodes = ['en', 'te', 'hi', 'or'];
const roleAccess = DEFAULT_ROLE_PERMISSIONS;
const roles = ROLE_NAMES;
const demoUsers = [
  { role: 'doctor', count: 5, prefix: 'Demo Doctor', keyPrefix: 'doctor' },
  { role: 'health_worker', count: 5, prefix: 'Demo Health Worker', keyPrefix: 'health_worker' },
  { role: 'specialist', count: 3, prefix: 'Demo Specialist', keyPrefix: 'specialist' },
];
const demoPatientCount = 10;
const languages = [
  { code: 'en', native_name: 'English', english_name: 'English' },
  { code: 'te', native_name: 'తెలుగు', english_name: 'Telugu' },
  { code: 'hi', native_name: 'हिन्दी', english_name: 'Hindi' },
  { code: 'or', native_name: 'ଓଡ଼ିଆ', english_name: 'Odia' },
];

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Synthetic demo seeding is disabled in production');
  }
  await checkConnection();
  const db = await getDb();
  const now = new Date();
  const collections = {
    roles: db.collection('roles'),
    permissions: db.collection('permissions'),
    users: db.collection('users'),
  };
  const roleLabels = {
    super_admin: 'Super administrator',
    admin: 'Administrator',
    doctor: 'Doctor',
    health_worker: 'Health worker',
    specialist: 'Specialist',
    patient: 'Patient',
  };
  const roleRecords = new Map();
  for (const role of roles) {
    await collections.roles.updateOne(
      { name: role },
      {
        $set: {
          name: role,
          description: roleLabels[role],
          is_system: true,
          updated_at: now,
        },
        $setOnInsert: {
          id: idFor(`role:${role}`),
          created_at: now,
          permissions: roleAccess[role],
          permissions_version: 1,
          permission_catalog_version: 2,
        },
      },
      { upsert: true },
    );
  }
  await ensurePermissionCatalog(db);
  for (const role of roles) {
    roleRecords.set(role, await collections.roles.findOne({ name: role }));
  }

  for (const legacy of [
    { role: 'super_admin', count: 1, keyPrefix: 'superadmin' },
    { role: 'admin', count: 2, keyPrefix: 'admin' },
  ]) {
    for (let index = 0; index < legacy.count; index += 1) {
      const ordinal = String(index + 1).padStart(2, '0');
      const id = idFor(`user:${legacy.role}:${index}`);
      const email = `${legacy.keyPrefix}${ordinal}@demo.example.test`;
      const existing = await collections.users.findOne({ id, email });
      if (!existing) continue;
      const now = new Date();
      await collections.users.updateOne(
        { id, email },
        {
          $set: {
            role: 'admin',
            is_active: false,
            deleted_at: now,
            admin_registration_status: 'rejected',
            updated_at: now,
          },
          $unset: { password_hash: '', email: '', mobile: '' },
        },
      );
      await db.collection('refresh_tokens').updateMany(
        { user_id: id, revoked_at: null },
        { $set: { revoked_at: now } },
      );
      await db.collection('audit_logs').insertOne({
        id: randomUUID(),
        user_id: null,
        action: 'system.demo_account_retired',
        entity: 'users',
        entity_id: id,
        metadata: { seeded_role: legacy.role },
        created_at: now,
      });
    }
  }

  const usersByRole = {};
  for (const spec of demoUsers) {
    usersByRole[spec.role] = [];
    for (let index = 0; index < spec.count; index += 1) {
      const ordinal = String(index + 1).padStart(2, '0');
      const id = idFor(`user:${spec.role}:${index}`);
      const user = {
        id,
        full_name: `${spec.prefix} ${index + 1}`,
        email: `${spec.keyPrefix}${ordinal}@demo.example.test`,
        mobile: `99999${String(roles.indexOf(spec.role) * 100 + index + 1).padStart(5, '0')}`,
        password_hash: await bcrypt.hash(`${randomBytes(32).toString('base64url')}Aa1`, 12),
        preferred_language: languageCodes[index % languageCodes.length],
        role: spec.role,
        permissions_version: roleRecords.get(spec.role).permissions_version,
        is_active: true,
        deleted_at: null,
        failed_login_count: 0,
        locked_until: null,
        must_change_password: false,
        updated_at: now,
      };
      await collections.users.updateOne(
        { id },
        { $set: user, $setOnInsert: { created_at: now } },
        { upsert: true },
      );
      usersByRole[spec.role].push(user);
    }
  }
  const patientUserIds = Array.from({ length: demoPatientCount }, (_, index) =>
    idFor(`user:patient:${index}`));
  await collections.users.updateMany(
    { id: { $in: patientUserIds } },
    {
      $set: { is_active: false, deleted_at: now, updated_at: now },
      $unset: { password_hash: '', email: '', mobile: '' },
    },
  );

  await db.collection('villages').updateMany(
    { village_code: /^DEMO-VIL-/ },
    { $set: { is_active: false, updated_at: now } },
  );
  await seedFacilityDirectory(db, now);

  const doctors = [];
  for (let index = 0; index < usersByRole.doctor.length; index += 1) {
    const doctor = {
      id: idFor(`doctor:${index}`),
      user_id: usersByRole.doctor[index].id,
      registration_number: `DEMO-DOC-${String(index + 1).padStart(3, '0')}`,
      qualification: 'Synthetic demonstration qualification',
    };
    await db.collection('doctors').updateOne(
      { user_id: doctor.user_id },
      {
        $set: doctor,
        $unset: { phc_id: '', hospital_id: '' },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
    doctors.push(doctor);
  }
  for (let index = 0; index < usersByRole.health_worker.length; index += 1) {
    const worker = {
      id: idFor(`health-worker:${index}`),
      user_id: usersByRole.health_worker[index].id,
      worker_code: `DEMO-HW-${String(index + 1).padStart(3, '0')}`,
    };
    await db.collection('health_workers').updateOne(
      { user_id: worker.user_id },
      {
        $set: worker,
      $unset: { phc_id: '', village_id: '' },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
  }
  const specialists = [];
  for (let index = 0; index < usersByRole.specialist.length; index += 1) {
    const specialist = {
      id: idFor(`specialist:${index}`),
      user_id: usersByRole.specialist[index].id,
      registration_number: `DEMO-SPEC-${String(index + 1).padStart(3, '0')}`,
      specialty: ['Oral medicine', 'Oral surgery', 'Oral pathology'][index],
    };
    await db.collection('specialists').updateOne(
      { user_id: specialist.user_id },
      { $set: specialist, $unset: { hospital_id: '' }, $setOnInsert: { created_at: now } },
      { upsert: true },
    );
    specialists.push(specialist);
  }

  const patients = [];
  for (let index = 0; index < demoPatientCount; index += 1) {
    const patient = {
      id: idFor(`patient:${index}`),
      patient_code: `AD-DEMO-${String(index + 1).padStart(4, '0')}`,
      client_uuid: idFor(`patient-registration:${index}`),
      full_name: index === 0 ? 'Demo Patient 1A' : `Demo Patient ${index + 1}`,
      age: 20 + index,
      gender: ['female', 'male', 'undisclosed'][index % 3],
      mobile: `99999${String(10000 + index + 1).padStart(5, '0')}`,
      village_name: '',
      gram_panchayat: `Demo GP ${index + 1}`,
      district: '',
      mandal: '',
      address: `Synthetic patient address ${index + 1}`,
      preferred_language: languageCodes[index % languageCodes.length],
      registered_by: usersByRole.health_worker[index % usersByRole.health_worker.length].id,
      is_active: true,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    await db.collection('patients').updateOne(
      { id: patient.id },
      {
        $set: patient,
        $unset: { user_id: '', phc_id: '', phc_name: '', village_id: '' },
      },
      { upsert: true },
    );
    await db.collection('medical_histories').updateOne(
      { patient_id: patient.id },
      {
        $set: {
          patient_id: patient.id,
          conditions: index % 2 ? ['synthetic_demo_condition'] : [],
          allergies: [],
          current_medications: [],
          tobacco_use: index % 3 === 0,
          tobacco_duration_months: index % 3 === 0 ? 12 + index : null,
          tobacco_frequency_per_day: index % 3 === 0 ? 1 : null,
          gutkha_use: false,
          areca_nut_use: false,
          recorded_by: patient.registered_by,
        },
        $setOnInsert: { id: idFor(`medical-history:${index}`), created_at: now },
      },
      { upsert: true },
    );
    await db.collection('patient_consents').updateOne(
      { patient_id: patient.id, consent_type: 'data_collection' },
      {
        $set: {
          patient_id: patient.id,
          consent_type: 'data_collection',
          granted: true,
          version: 1,
          language: patient.preferred_language,
          granted_at: now,
          recorded_by: patient.registered_by,
        },
        $setOnInsert: { id: idFor(`consent:${index}`), created_at: now },
      },
      { upsert: true },
    );
    patients.push(patient);
  }

  for (const language of languages) {
    await db.collection('languages').updateOne(
      { code: language.code },
      { $set: { ...language, is_active: true } },
      { upsert: true },
    );
  }
  return { database: db.databaseName, users: Object.values(usersByRole).flat().length, patients: patients.length };
}

seed()
  .then((result) => {
    logger.info('MongoDB synthetic demonstration seed completed', result);
  })
  .catch((error) => {
    logger.error('MongoDB seed failed', { errorMessage: error.message });
    process.exitCode = 1;
  })
  .finally(closeMongo);
