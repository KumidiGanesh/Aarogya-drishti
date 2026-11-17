const { getDb } = require('../db/mongo');
const { randomUUID } = require('node:crypto');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function dateFilter(field, query) {
  const filter = {};
  if (query.from) filter.$gte = new Date(`${query.from}T00:00:00.000Z`);
  if (query.to) filter.$lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86400000);
  return Object.keys(filter).length ? { [field]: filter } : {};
}

function groupCount(items, key) {
  const groups = new Map();
  for (const item of items) {
    const name = key(item) || 'Unspecified';
    groups.set(name, (groups.get(name) || 0) + 1);
  }
  return [...groups]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, 100);
}

async function analytics(query, user, req) {
  const db = await getDb();
  let doctorPhc = null;
  if (user.role === 'doctor') {
    const doctor = await db.collection('doctors').findOne({ user_id: user.sub });
    doctorPhc = doctor?.phc_id;
    if (!doctorPhc)
      throw httpError(403, 'PHC_REQUIRED', 'Analytics access requires an assigned PHC');
  }
  const phcId = query.phc_id || doctorPhc;
  const patientFilter = { deleted_at: null };
  if (query.district)
    patientFilter.district = new RegExp(
      `^${query.district.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
      'i',
    );
  if (phcId) patientFilter.phc_id = phcId;
  const patients = await db.collection('patients').find(patientFilter).toArray();
  const registrations = patients.filter((patient) => {
    const createdAt = new Date(patient.created_at).getTime();
    const from = query.from ? new Date(`${query.from}T00:00:00.000Z`).getTime() : -Infinity;
    const to = query.to ? new Date(`${query.to}T00:00:00.000Z`).getTime() + 86400000 : Infinity;
    return createdAt >= from && createdAt < to;
  });
  const patientIds = patients.map((patient) => patient.id);
  const villages = await db.collection('villages').find({}).toArray();
  const phcs = await db.collection('phcs').find({}).toArray();
  const villageMap = new Map(villages.map((item) => [item.id, item.name]));
  const phcMap = new Map(phcs.map((item) => [item.id, item.name]));
  const screenings = await db
    .collection('oral_screenings')
    .find({
      patient_id: { $in: patientIds },
      ...dateFilter('screened_at', query),
    })
    .toArray();
  const screeningIds = screenings.map((item) => item.id);
  const aiResults = await db
    .collection('ai_screening_results')
    .find({ screening_id: { $in: screeningIds } })
    .sort({ created_at: -1 })
    .toArray();
  const latestRisk = new Map();
  for (const result of aiResults)
    if (!latestRisk.has(result.screening_id))
      latestRisk.set(
        result.screening_id,
        (!result.is_demo && result.risk_category) || 'unanalysed',
      );
  const referrals = await db
    .collection('referrals')
    .find({
      patient_id: { $in: patientIds },
      ...dateFilter('created_at', query),
    })
    .toArray();
  const hospitals = await db.collection('hospitals').find({}).toArray();
  const hospitalMap = new Map(hospitals.map((item) => [item.id, item.name]));
  const appointments = await db
    .collection('appointments')
    .find({
      patient_id: { $in: patientIds },
      ...dateFilter('scheduled_at', query),
      ...(phcId ? { facility_type: 'phc', facility_id: phcId } : {}),
    })
    .toArray();
  const reminderPatients = patients.map((patient) => patient.id);
  const reminders = await db
    .collection('medicine_reminders')
    .find({ patient_id: { $in: reminderPatients } })
    .toArray();
  const reminderMap = new Map(reminders.map((item) => [item.id, item]));
  const medicineIds = [...new Set(reminders.map((item) => item.medicine_id))];
  const medicines = await db
    .collection('medicines')
    .find({ id: { $in: medicineIds } })
    .toArray();
  const medicineMap = new Map(medicines.map((item) => [item.id, item.name]));
  const medicationLogs = await db
    .collection('medication_logs')
    .find({
      reminder_id: { $in: [...reminderMap.keys()] },
      ...dateFilter('scheduled_for', query),
    })
    .toArray();
  const adherenceByMedicine = new Map();
  for (const log of medicationLogs) {
    const reminder = reminderMap.get(log.reminder_id);
    const name = medicineMap.get(reminder?.medicine_id) || 'Unspecified';
    const counts = adherenceByMedicine.get(name) || { name, taken: 0, missed: 0 };
    if (log.status === 'taken') counts.taken += 1;
    if (log.status === 'missed') counts.missed += 1;
    adherenceByMedicine.set(name, counts);
  }
  const emergencies = await db
    .collection('emergency_requests')
    .find({
      patient_id: { $in: patientIds },
      ...dateFilter('created_at', query),
    })
    .toArray();
  const data = {
    total_registrations: registrations.length,
    village_statistics: groupCount(
      registrations,
      (item) => villageMap.get(item.village_id) || item.village_name,
    ),
    phc_statistics: groupCount(registrations, (item) => phcMap.get(item.phc_id) || item.phc_name),
    district_statistics: groupCount(registrations, (item) => item.district),
    screening_statistics: [
      ...screenings
        .reduce((groups, screening) => {
          const key = `${screening.status || 'unknown'}\u0000${latestRisk.get(screening.id) || 'unanalysed'}`;
          const value = groups.get(key) || {
            status: screening.status,
            risk_category: latestRisk.get(screening.id) || 'unanalysed',
            total: 0,
          };
          value.total += 1;
          groups.set(key, value);
          return groups;
        }, new Map())
        .values(),
    ].sort(
      (a, b) =>
        String(a.status).localeCompare(String(b.status)) ||
        String(a.risk_category).localeCompare(String(b.risk_category)),
    ),
    referral_statistics: [
      ...referrals
        .reduce((groups, referral) => {
          const hospital = hospitalMap.get(referral.hospital_id) || 'Unspecified';
          const key = `${referral.status || 'unknown'}\u0000${hospital}`;
          const value = groups.get(key) || { status: referral.status, hospital, total: 0 };
          value.total += 1;
          groups.set(key, value);
          return groups;
        }, new Map())
        .values(),
    ].sort(
      (a, b) =>
        String(a.status).localeCompare(String(b.status)) || a.hospital.localeCompare(b.hospital),
    ),
    appointment_statistics: groupCount(appointments, (item) => item.status)
      .map(({ name, total }) => ({ status: name, total }))
      .sort((a, b) => String(a.status).localeCompare(String(b.status))),
    medicine_adherence: [...adherenceByMedicine.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 100)
      .map((row) => ({
        ...row,
        adherence_percent:
          row.taken + row.missed ? Math.round((row.taken / (row.taken + row.missed)) * 100) : null,
      })),
    emergency_statistics: groupCount(emergencies, (item) => item.status)
      .map(({ name, total }) => ({ status: name, total }))
      .sort((a, b) => String(a.status).localeCompare(String(b.status))),
  };
  if (!query.export) return { data };
  if (!['reports.export', 'export'].some((permission) => user.permissions?.includes(permission))) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to export reports');
  }
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: user.sub,
    action: 'reports.analytics.export',
    entity: 'reports',
    entity_id: null,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata: { format: query.export, phc_id: phcId || null },
    created_at: new Date(),
  });
  return { data, export: query.export };
}

module.exports = { analytics };
