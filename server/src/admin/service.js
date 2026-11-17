const bcrypt = require('bcrypt');
const { randomBytes, randomUUID } = require('node:crypto');
const { getDb } = require('../db/mongo');
const notificationService = require('../services/notificationService');
const {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_CATALOG_VERSION,
  ROLE_NAMES,
} = require('../auth/permissions');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function writeAudit(db, req, { action, entity, entityId, metadata = {} }) {
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: req.user.sub,
    action,
    entity,
    entity_id: entityId ? String(entityId) : null,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata,
    created_at: new Date(),
  });
}

function userSummary(row) {
  const requestStatus = row.role === 'doctor' ? row.doctor_request_status || null : null;
  const adminRequestStatus = row.role === 'admin' ? row.admin_registration_status || null : null;
  const pendingApproval =
    requestStatus === 'pending' ||
    adminRequestStatus === 'pending' ||
    Boolean(row.pending_approval);
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    username: row.username || null,
    admin_id: row.admin_id || null,
    mobile: row.mobile,
    role: row.role,
    is_active: row.is_active,
    pending_approval: pendingApproval,
    doctor_request_status: requestStatus,
    admin_registration_status: adminRequestStatus,
    account_status:
      requestStatus === 'pending'
        ? 'pending_approval'
        : requestStatus === 'rejected'
          ? 'rejected'
          : adminRequestStatus === 'pending'
            ? 'pending_approval'
            : adminRequestStatus === 'rejected'
              ? 'rejected'
              : pendingApproval
                ? 'pending_approval'
                : row.is_active
                  ? 'active'
                  : 'inactive',
    preferred_language: row.preferred_language,
    must_change_password: row.must_change_password,
    created_at: row.created_at,
    created_by: row.created_by || null,
  };
}

function dateValue(value) {
  return value instanceof Date ? value : new Date(value);
}

function matchesDistrict(item, district) {
  return !district || String(item?.district || '').toLowerCase() === district.toLowerCase();
}

async function dashboard({ district }, role = 'admin') {
  const db = await getDb();
  const [
    patients,
    users,
    doctors,
    workers,
    specialists,
    hospitals,
    appointments,
    referrals,
    allReferrals,
    consultations,
    emergencies,
    villages,
    phcs,
    auditLogs,
    permissions,
    screenings,
    screeningResults,
    facilityLocations,
  ] = await Promise.all([
    db.collection('patients').find({ deleted_at: null }).toArray(),
    db.collection('users').find({ deleted_at: null }).toArray(),
    db.collection('doctors').find({}).toArray(),
    db.collection('health_workers').find({}).toArray(),
    db.collection('specialists').find({}).toArray(),
    db.collection('hospitals').find({ is_active: true }).toArray(),
    db.collection('appointments').find({ deleted_at: null }).toArray(),
    db.collection('referrals').find({ status: 'pending' }).toArray(),
    db.collection('referrals').find({ deleted_at: null }).toArray(),
    db.collection('consultations').find({ status: 'completed' }).toArray(),
    db
      .collection('emergency_requests')
      .find({ status: { $in: ['open', 'acknowledged'] } })
      .toArray(),
    db.collection('villages').find({}).toArray(),
    db.collection('phcs').find({}).toArray(),
    db.collection('audit_logs').find({}).toArray(),
    db.collection('permissions').find({}).toArray(),
    db.collection('oral_screenings').find({ deleted_at: null }).toArray(),
    db.collection('ai_screening_results').find({}).toArray(),
    db.collection('facility_locations').find({}).toArray(),
  ]);
  const activeUsers = users.filter((item) => item.is_active);
  const userById = new Map(activeUsers.map((item) => [item.id, item]));
  const villageMap = new Map(villages.map((item) => [item.id, item]));
  const phcMap = new Map(phcs.map((item) => [item.id, item]));
  const hospitalMap = new Map(hospitals.map((item) => [item.id, item]));
  const qualifies = (profile, relation) => {
    const user = userById.get(profile.user_id);
    if (!user) return false;
    if (!district) return true;
    const site = relation(profile);
    return matchesDistrict(site, district);
  };
  const patientRows = patients.filter((item) => matchesDistrict(item, district));
  const patientIds = new Set(patientRows.map((item) => item.id));
  const doctorCount = doctors.filter((item) =>
    qualifies(item, (profile) =>
      [
        profile.phc_id && phcMap.get(profile.phc_id),
        profile.hospital_id && hospitalMap.get(profile.hospital_id),
      ]
        .filter(Boolean)
        .some((site) => matchesDistrict(site, district)),
    ),
  ).length;
  const doctorUsers = users.filter((item) => item.role === 'doctor');
  const approvedDoctorCount = doctors.filter((item) => {
    const user = userById.get(item.user_id);
    return user && (!user.doctor_request_status || user.doctor_request_status === 'approved');
  }).length;
  const pendingDoctorCount = doctorUsers.filter(
    (item) => item.doctor_request_status === 'pending',
  ).length;
  const pendingAdminCount = users.filter(
    (item) => item.role === 'admin' && item.admin_registration_status === 'pending',
  ).length;
  const workerCount = workers.filter((item) =>
    qualifies(item, (profile) =>
      [
        profile.village_id && villageMap.get(profile.village_id),
        profile.phc_id && phcMap.get(profile.phc_id),
      ]
        .filter(Boolean)
        .some((site) => matchesDistrict(site, district)),
    ),
  ).length;
  const specialistCount = specialists.filter((item) =>
    qualifies(item, (profile) => hospitalMap.get(profile.hospital_id)),
  ).length;
  const filteredAppointments = appointments.filter((item) => patientIds.has(item.patient_id));
  const filteredScreenings = screenings.filter((item) => patientIds.has(item.patient_id));
  const screeningIds = new Set(filteredScreenings.map((item) => item.id));
  const filteredScreeningResults = screeningResults.filter((item) => screeningIds.has(item.screening_id) && item.is_demo !== true);
  const patientById = new Map(patientRows.map((patient) => [patient.id, patient]));
  const facilityScreeningCounts = facilityLocations.map((facility) => {
    const name = String(facility.name || '').toLocaleLowerCase('en');
    const count = filteredScreenings.filter((screening) => {
      const patient = patientById.get(screening.patient_id);
      return [patient?.phc_name, patient?.hospital_name, patient?.facility_name]
        .some((value) => String(value || '').toLocaleLowerCase('en') === name);
    }).length;
    return { name: facility.name, screenings: count };
  }).filter((item) => item.screenings > 0).sort((a, b) => b.screenings - a.screenings).slice(0, 10);
  const filteredReferrals = referrals.filter((item) => patientIds.has(item.patient_id));
  const filteredConsultations = consultations.filter((item) => patientIds.has(item.patient_id));
  const filteredEmergencies = emergencies.filter((item) => patientIds.has(item.patient_id));
  const now = new Date();
  const recentFrom = new Date(now.getTime() - 30 * 86400000);
  const trendData = patientRows.filter((item) => dateValue(item.created_at) >= recentFrom);
  const daily = new Map();
  for (const patient of trendData) {
    const date = dateValue(patient.created_at).toISOString().slice(0, 10);
    daily.set(date, (daily.get(date) || 0) + 1);
  }

  const makeTrend = (days) =>
    Array.from({ length: days }, (_, index) => {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - (days - index - 1));
      const key = date.toISOString().slice(0, 10);
      return { date: key, registrations: daily.get(key) || 0 };
    });
  const appointmentCount = (status) => filteredAppointments.filter((item) => item.status === status).length;
  const riskDistribution = filteredScreeningResults.reduce((counts, result) => {
    const category = String(result.risk_category || 'unclassified').toLowerCase();
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
  const recentRegistrations = [...patientRows]
    .sort((a, b) => dateValue(b.created_at) - dateValue(a.created_at))
    .slice(0, 10)
    .map((patient) => ({
      id: patient.id,
      patient_code: patient.patient_code,
      ...(role === 'super_admin' ? { full_name: patient.full_name } : {}),
      created_at: patient.created_at,
      village_name: villageMap.get(patient.village_id)?.name || patient.village_name || null,
      phc_name: phcMap.get(patient.phc_id)?.name || patient.phc_name || null,
    }));
    const calcChange = (items, dateGetter = (i) => i.created_at) => {
      let curr = 0;
      let prev = 0;
      const periodStart = new Date(now.getTime() - 30 * 86400000);
      const prevPeriodStart = new Date(now.getTime() - 60 * 86400000);
      for (const item of items) {
        const d = dateValue(dateGetter(item));
        if (!Number.isNaN(d.getTime())) {
          if (d >= periodStart && d <= now) curr += 1;
          else if (d >= prevPeriodStart && d < periodStart) prev += 1;
        }
      }
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    const makeSparkline = (items, days = 7, dateGetter = (i) => i.created_at) => {
      const counts = Array.from({ length: days }, () => 0);
      const dayMs = 86400000;
      for (const item of items) {
        const d = dateValue(dateGetter(item));
        if (!Number.isNaN(d.getTime())) {
          const diffDays = Math.floor((now.getTime() - d.getTime()) / dayMs);
          if (diffDays >= 0 && diffDays < days) {
            counts[days - 1 - diffDays] += 1;
          }
        }
      }
      return counts;
    };

    const pendingApptsList = filteredAppointments.filter((a) => ['booked', 'rescheduled', 'pending'].includes(a.status));
    const completedApptsList = filteredAppointments.filter((a) => a.status === 'completed');
    const pendingScreeningReviewList = filteredScreenings.filter((item) =>
      ['submitted', 'under_review'].includes(item.status),
    );
    const adminManagersList = users.filter((u) => u.role === 'admin' && u.is_active);

    const kpis = {
      totalHospitals: {
        value: hospitals.filter((item) => matchesDistrict(item, district)).length,
        changePercent: calcChange(hospitals),
        trend: makeSparkline(hospitals),
      },
      totalHospitalManagers: {
        value: adminManagersList.length || new Set(facilityLocations.map((item) => item.manager_user_id).filter(Boolean)).size,
        changePercent: calcChange(adminManagersList),
        trend: makeSparkline(adminManagersList),
      },
      totalDoctors: {
        value: approvedDoctorCount || doctorCount,
        changePercent: calcChange(doctors),
        trend: makeSparkline(doctors),
      },
      totalPatients: {
        value: patientRows.length,
        changePercent: calcChange(patientRows),
        trend: makeSparkline(patientRows),
      },
      totalScreenings: {
        value: filteredScreenings.length,
        changePercent: calcChange(filteredScreenings),
        trend: makeSparkline(filteredScreenings),
      },
      pendingScreeningReviews: {
        value: pendingScreeningReviewList.length,
        changePercent: calcChange(pendingScreeningReviewList),
        trend: makeSparkline(pendingScreeningReviewList),
      },
      totalAppointments: {
        value: filteredAppointments.length,
        changePercent: calcChange(filteredAppointments, (a) => a.scheduled_at || a.created_at),
        trend: makeSparkline(filteredAppointments, 7, (a) => a.scheduled_at || a.created_at),
      },
      pendingAppointments: {
        value: pendingApptsList.length,
        changePercent: calcChange(pendingApptsList),
        trend: makeSparkline(pendingApptsList),
      },
      completedAppointments: {
        value: completedApptsList.length,
        changePercent: calcChange(completedApptsList),
        trend: makeSparkline(completedApptsList),
      },
    };

  return {
    kpis,
    totalPatients: patientRows.length,
    totalDoctors: doctorCount,
    userRoleDistribution: {
      patient: patientRows.length,
      doctor: doctorCount,
      admin: activeUsers.filter((item) => item.role === 'admin').length,
    },
    approvedDoctors: approvedDoctorCount,
    pendingDoctorRegistrations: pendingDoctorCount,
    pendingAdminRegistrations: pendingAdminCount,
    totalReferrals: allReferrals.length,
    patientRecords: patientRows.length,
    websiteAccessPermissions: permissions.length,
    auditLogCount: auditLogs.length,
    totalHealthWorkers: workerCount,
    totalSpecialists: specialistCount,
    totalHospitals: hospitals.filter((item) => matchesDistrict(item, district)).length,
    totalAppointments: filteredAppointments.length,
    pendingAppointments: appointmentCount('booked') + appointmentCount('rescheduled'),
    completedAppointments: appointmentCount('completed'),
    cancelledAppointments: appointmentCount('cancelled'),
    missedAppointments: appointmentCount('missed'),
    totalScreenings: filteredScreenings.length,
    pendingScreeningReviews: filteredScreenings.filter((item) => ['submitted', 'under_review'].includes(item.status)).length,
    followUpRequired: filteredScreenings.filter((item) => item.follow_up_date || item.follow_up_recommendation).length,
    screeningRiskDistribution: riskDistribution,
    screeningTrend: makeScreeningTrend(filteredScreenings),
    facilityScreeningCounts,
    totalRegisteredFacilities: facilityLocations.length,
    activeFacilities: facilityLocations.filter((item) => item.is_active).length,
    inactiveFacilities: facilityLocations.filter((item) => !item.is_active).length,
    pendingFacilityVerification: facilityLocations.filter((item) => item.verification_status === 'unverified').length,
    totalHospitalManagers: new Set(facilityLocations.map((item) => item.manager_user_id).filter(Boolean)).size,
    pendingReferrals: filteredReferrals.length,
    completedConsultations: filteredConsultations.length,
    emergencyRequests: filteredEmergencies.length,
    recentRegistrations,
    registrationTrend: { days7: makeTrend(7), days30: makeTrend(30) },
  };
}

async function listRiskCases(query = {}, role = 'admin') {
  if (role !== 'super_admin' && role !== 'admin') {
    throw httpError(403, 'FORBIDDEN', 'Administrator access is required');
  }
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw httpError(400, 'INVALID_PAGINATION', 'page must be positive and limit must be between 1 and 100');
  }
  const db = await getDb();
  const [screenings, patients, results, doctors, users] = await Promise.all([
    db.collection('oral_screenings').find({ deleted_at: null }).toArray(),
    db.collection('patients').find({ is_active: true, deleted_at: null }).toArray(),
    db.collection('ai_screening_results').find({}).sort({ created_at: -1 }).toArray(),
    db.collection('doctors').find({}).toArray(),
    db.collection('users').find({ deleted_at: null }).toArray(),
  ]);
  const patientById = new Map(patients.map((patient) => [patient.id, patient]));
  const resultByScreening = new Map();
  for (const result of results) {
    if (!resultByScreening.has(result.screening_id)) resultByScreening.set(result.screening_id, result);
  }
  const doctorById = new Map(doctors.map((doctor) => [doctor.id, doctor]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const allowedRisk = /high|critical|urgent|moderate|normal/i;
  let rows = screenings.flatMap((screening) => {
    const patient = patientById.get(screening.patient_id);
    const result = resultByScreening.get(screening.id);
    const risk = String(result?.risk_category || 'moderate').toLowerCase();
    if (!patient || result?.is_demo === true || !allowedRisk.test(risk)) return [];
    const assignedDoctor = doctorById.get(screening.assigned_doctor_id || patient.assigned_doctor_id);
    const doctorUser = assignedDoctor && userById.get(assignedDoctor.user_id);
    const birth = patient.date_of_birth ? new Date(patient.date_of_birth) : null;
    const age = birth && !Number.isNaN(birth.getTime())
      ? Math.max(0, Math.floor((Date.now() - birth.getTime()) / 31557600000))
      : null;
    const followUpStatus = screening.follow_up_status || (screening.follow_up_date ? 'scheduled' : (risk === 'high' || risk === 'critical' ? 'needs_follow_up' : 'none'));
    const observations = result?.result_data?.visible_observations || [];
    const category = observations.length > 0
      ? observations.map((o) => o.type || o.description).join(', ')
      : (risk === 'normal' ? 'Normal Mucosa' : (risk ? `${risk.toUpperCase()} Risk Finding` : 'General Evaluation'));

    return [{
      id: screening.id,
      patient_id: patient.id,
      patient_code: patient.patient_code || patient.id,
      patient_name: role === 'super_admin' ? patient.full_name : `${patient.full_name?.slice(0, 1) || 'P'}***`,
      age,
      gender: patient.gender || null,
      facility: patient.phc_name || patient.hospital_name || patient.facility_name || 'ITDA Community Center',
      screening_category: category,
      risk_category: risk,
      screening_date: screening.screened_at || screening.created_at,
      assigned_doctor: doctorUser?.full_name || null,
      assigned_doctor_id: assignedDoctor?.id || null,
      follow_up_date: screening.follow_up_date || result?.follow_up_date || null,
      follow_up_status: followUpStatus,
      notes: screening.notes || '',
      result_summary: result?.result_data?.findings || result?.result_data?.explanation || null,
    }];
  }).sort((a, b) => new Date(b.screening_date) - new Date(a.screening_date));

  const distribution = rows.reduce((counts, row) => {
    counts[row.risk_category] = (counts[row.risk_category] || 0) + 1;
    return counts;
  }, { normal: 0, moderate: 0, high: 0, critical: 0 });

  if (query.risk && query.risk !== 'all') {
    rows = rows.filter((r) => r.risk_category === query.risk.toLowerCase());
  }
  if (query.facility) {
    rows = rows.filter((r) => (r.facility || '').toLowerCase().includes(query.facility.toLowerCase()));
  }
  if (query.follow_up_status && query.follow_up_status !== 'all') {
    rows = rows.filter((r) => r.follow_up_status === query.follow_up_status);
  }
  if (query.search) {
    const s = query.search.toLowerCase();
    rows = rows.filter((r) =>
      r.patient_code.toLowerCase().includes(s) ||
      (r.patient_name || '').toLowerCase().includes(s) ||
      (r.assigned_doctor || '').toLowerCase().includes(s) ||
      (r.facility || '').toLowerCase().includes(s)
    );
  }

  return {
    items: rows.slice((page - 1) * limit, page * limit),
    distribution,
    meta: { page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) || 1 },
  };
}

async function assignScreeningDoctor(id, { doctor_id }, req) {
  const db = await getDb();
  const screening = await db.collection('oral_screenings').findOne({ id, deleted_at: null });
  if (!screening) throw httpError(404, 'SCREENING_NOT_FOUND', 'Screening not found');
  const doctor = (await db.collection('doctors').findOne({ id: doctor_id })) ||
                 (await db.collection('doctors').findOne({ user_id: doctor_id })) ||
                 (await db.collection('users').findOne({ id: doctor_id, role: 'doctor' }));
  if (!doctor) throw httpError(422, 'INVALID_DOCTOR', 'Selected doctor was not found');
  const now = new Date();
  await db.collection('oral_screenings').updateOne(
    { id },
    { $set: { assigned_doctor_id: doctor.id || doctor_id, updated_at: now } }
  );
  await writeAudit(db, req, {
    action: 'admin.screening.doctor_assigned',
    entity: 'oral_screenings',
    entityId: id,
    metadata: { doctor_id },
  });
  return { id, assigned_doctor_id: doctor.id || doctor_id, updated_at: now };
}

async function updateScreeningFollowUp(id, { follow_up_date, follow_up_status, notes }, req) {
  const db = await getDb();
  const screening = await db.collection('oral_screenings').findOne({ id, deleted_at: null });
  if (!screening) throw httpError(404, 'SCREENING_NOT_FOUND', 'Screening not found');
  const now = new Date();
  const updates = {
    follow_up_status,
    updated_at: now,
  };
  if (follow_up_date !== undefined) updates.follow_up_date = follow_up_date ? new Date(follow_up_date) : null;
  if (notes) updates.follow_up_notes = notes;

  await db.collection('oral_screenings').updateOne({ id }, { $set: updates });
  await writeAudit(db, req, {
    action: 'admin.screening.follow_up_updated',
    entity: 'oral_screenings',
    entityId: id,
    metadata: { follow_up_date, follow_up_status },
  });
  return { id, ...updates };
}

async function screeningAnalytics(query = {}) {
  const db = await getDb();
  const [screenings, patients, results] = await Promise.all([
    db.collection('oral_screenings').find({ deleted_at: null }).toArray(),
    db.collection('patients').find({ deleted_at: null }).toArray(),
    db.collection('ai_screening_results').find({}).toArray(),
  ]);

  const patientById = new Map(patients.map((p) => [p.id, p]));
  const resultByScreening = new Map();
  for (const res of results) {
    if (!resultByScreening.has(res.screening_id)) resultByScreening.set(res.screening_id, res);
  }

  const now = new Date();
  let start = new Date(0);
  let end = new Date(now.getTime() + 86400000);
  if (query.range === 'today') {
    start = new Date(); start.setUTCHours(0, 0, 0, 0);
  } else if (query.range === '7d') {
    start = new Date(now.getTime() - 7 * 86400000);
  } else if (query.range === '30d') {
    start = new Date(now.getTime() - 30 * 86400000);
  } else if (query.range === '90d') {
    start = new Date(now.getTime() - 90 * 86400000);
  } else if (query.from || query.to) {
    if (query.from) start = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) {
      end = new Date(`${query.to}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
    }
  }

  const filtered = screenings.filter((s) => {
    const d = dateValue(s.screened_at || s.created_at);
    if (d < start || d >= end) return false;
    const patient = patientById.get(s.patient_id);
    if (!patient) return false;
    const facilityName = (patient.phc_name || patient.hospital_name || patient.facility_name || '').toLowerCase();
    if (query.facility_name && !facilityName.includes(query.facility_name.toLowerCase())) return false;
    if (query.area && !(patient.mandal || patient.district || '').toLowerCase().includes(query.area.toLowerCase())) return false;
    const res = resultByScreening.get(s.id);
    const risk = String(res?.risk_category || 'unclassified').toLowerCase();
    if (query.risk && query.risk !== 'all' && risk !== query.risk.toLowerCase()) return false;
    return true;
  });

  let normal = 0, moderate = 0, high = 0, critical = 0, pendingReview = 0, followUpRequired = 0;
  const categoryCounts = new Map();
  const facilityCounts = new Map();

  for (const s of filtered) {
    const res = resultByScreening.get(s.id);
    const risk = String(res?.risk_category || 'moderate').toLowerCase();
    if (risk === 'normal') normal += 1;
    else if (risk === 'moderate') moderate += 1;
    else if (risk === 'high') high += 1;
    else if (risk === 'critical' || risk === 'urgent') critical += 1;

    if (['submitted', 'under_review', 'pending'].includes(s.status)) pendingReview += 1;
    if (s.follow_up_date || s.follow_up_recommendation || s.follow_up_status === 'needs_follow_up') followUpRequired += 1;

    const observations = res?.result_data?.visible_observations || [];
    if (observations.length > 0) {
      for (const obs of observations) {
        const cat = obs.type || obs.location || 'Oral Mucosal Change';
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
      }
    } else {
      const fallbackCat = risk === 'normal' ? 'Normal Mucosa' : (risk ? `${risk.toUpperCase()} Risk Finding` : 'General Screening');
      categoryCounts.set(fallbackCat, (categoryCounts.get(fallbackCat) || 0) + 1);
    }

    const patient = patientById.get(s.patient_id);
    const fac = patient?.phc_name || patient?.hospital_name || patient?.facility_name || 'General Facility';
    if (!facilityCounts.has(fac)) {
      facilityCounts.set(fac, { name: fac, total: 0, normal: 0, moderate: 0, high: 0, critical: 0 });
    }
    const item = facilityCounts.get(fac);
    item.total += 1;
    if (risk === 'normal') item.normal += 1;
    else if (risk === 'moderate') item.moderate += 1;
    else if (risk === 'high') item.high += 1;
    else if (risk === 'critical' || risk === 'urgent') item.critical += 1;
  }

  const categoryDistribution = Array.from(categoryCounts.entries()).map(([category, count]) => ({
    category,
    count,
    percentage: filtered.length > 0 ? Math.round((count / filtered.length) * 100) : 0,
  })).sort((a, b) => b.count - a.count).slice(0, 8);

  const hospitalWiseComparison = Array.from(facilityCounts.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return {
    totalScreenings: filtered.length,
    normalCases: normal,
    moderateRiskCases: moderate,
    highRiskCases: high,
    criticalCases: critical,
    pendingScreeningReviews: pendingReview,
    followUpRequired,
    screeningTrend: makeScreeningTrend(filtered),
    categoryDistribution,
    hospitalWiseComparison,
    riskDistribution: [
      { name: 'Normal', count: normal, color: '#10b981' },
      { name: 'Moderate', count: moderate, color: '#f59e0b' },
      { name: 'High Risk', count: high, color: '#f97316' },
      { name: 'Critical / Urgent', count: critical, color: '#ef4444' },
    ],
  };
}

async function appointmentManagement(query = {}) {
  const db = await getDb();
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  const [appointments, patients, doctors, users, hospitals, phcs, facilityLocations] = await Promise.all([
    db.collection('appointments').find({ deleted_at: null }).toArray(),
    db.collection('patients').find({ deleted_at: null }).toArray(),
    db.collection('doctors').find({}).toArray(),
    db.collection('users').find({ deleted_at: null }).toArray(),
    db.collection('hospitals').find({ is_active: true }).toArray(),
    db.collection('phcs').find({ is_active: true }).toArray(),
    db.collection('facility_locations').find({}).toArray(),
  ]);

  const patientById = new Map(patients.map((p) => [p.id, p]));
  const doctorById = new Map(doctors.map((d) => [d.id, d]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const facilityMap = new Map();
  for (const h of hospitals) facilityMap.set(h.id, h.name);
  for (const p of phcs) facilityMap.set(p.id, p.name);
  for (const f of facilityLocations) facilityMap.set(f.id, f.name);

  const now = new Date();
  let total = appointments.length;
  let upcoming = 0, pending = 0, completed = 0, cancelled = 0, missed = 0;

  for (const appt of appointments) {
    const s = appt.status;
    const scheduled = dateValue(appt.scheduled_at);
    if (s === 'completed') completed += 1;
    else if (s === 'cancelled') cancelled += 1;
    else if (s === 'missed') missed += 1;
    else if (s === 'booked' || s === 'rescheduled' || s === 'pending') {
      pending += 1;
      if (scheduled >= now) upcoming += 1;
    }
  }

  let filtered = appointments.map((appt) => {
    const patient = patientById.get(appt.patient_id);
    const doctor = doctorById.get(appt.doctor_id);
    const doctorUser = doctor && userById.get(doctor.user_id);
    const facilityName = facilityMap.get(appt.facility_id) || appt.facility_name || patient?.phc_name || patient?.hospital_name || 'Primary Care Center';
    return {
      id: appt.id,
      patient_id: appt.patient_id,
      patient_code: patient?.patient_code || 'N/A',
      patient_name: patient?.full_name || 'Authorized Patient',
      doctor_id: appt.doctor_id,
      doctor_name: doctorUser ? doctorUser.full_name : 'To be assigned',
      facility_id: appt.facility_id,
      hospital: facilityName,
      facility_type: appt.facility_type || 'primary_care',
      scheduled_at: appt.scheduled_at,
      appointment_date: appt.scheduled_at ? new Date(appt.scheduled_at).toISOString().slice(0, 10) : 'TBD',
      appointment_time: appt.slot || (appt.scheduled_at ? new Date(appt.scheduled_at).toISOString().slice(11, 16) : 'TBD'),
      appointment_type: appt.appointment_type || 'general',
      status: appt.status || 'booked',
      notes: appt.notes || '',
      created_at: appt.created_at,
    };
  });

  if (query.status && query.status !== 'all') {
    if (query.status === 'upcoming') {
      filtered = filtered.filter((a) => ['booked', 'rescheduled', 'pending', 'confirmed'].includes(a.status) && new Date(a.scheduled_at) >= now);
    } else if (query.status === 'pending') {
      filtered = filtered.filter((a) => ['booked', 'rescheduled', 'pending'].includes(a.status));
    } else {
      filtered = filtered.filter((a) => a.status === query.status);
    }
  }
  if (query.doctor_id) filtered = filtered.filter((a) => a.doctor_id === query.doctor_id);
  if (query.hospital_id) filtered = filtered.filter((a) => a.facility_id === query.hospital_id || a.hospital.toLowerCase().includes(query.hospital_id.toLowerCase()));
  if (query.search) {
    const s = query.search.toLowerCase();
    filtered = filtered.filter((a) => a.patient_code.toLowerCase().includes(s) || a.patient_name.toLowerCase().includes(s) || a.doctor_name.toLowerCase().includes(s) || a.hospital.toLowerCase().includes(s));
  }

  filtered.sort((a, b) => new Date(b.scheduled_at || b.created_at) - new Date(a.scheduled_at || a.created_at));

  return {
    metrics: {
      totalAppointments: total,
      upcomingAppointments: upcoming,
      pendingAppointments: pending,
      completedAppointments: completed,
      cancelledAppointments: cancelled,
      missedAppointments: missed,
    },
    items: filtered.slice((page - 1) * limit, page * limit),
    meta: {
      page,
      limit,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / limit) || 1,
    },
  };
}

async function updateAppointmentStatus(id, { action, doctor_id, scheduled_at, slot, notes }, req) {
  const db = await getDb();
  const appt = await db.collection('appointments').findOne({ id, deleted_at: null });
  if (!appt) throw httpError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
  const now = new Date();
  const updates = { updated_at: now };

  if (action === 'approve') updates.status = 'confirmed';
  else if (action === 'reject') updates.status = 'cancelled';
  else if (action === 'cancel') updates.status = 'cancelled';
  else if (action === 'complete') updates.status = 'completed';
  else if (action === 'reschedule') {
    updates.status = 'rescheduled';
    if (scheduled_at) updates.scheduled_at = new Date(scheduled_at);
    if (slot) updates.slot = slot;
  } else if (action === 'assign_doctor') {
    if (!doctor_id) throw httpError(422, 'DOCTOR_REQUIRED', 'Doctor ID is required');
    updates.doctor_id = doctor_id;
  }
  if (notes) updates.notes = notes;

  await db.collection('appointments').updateOne({ id }, { $set: updates });
  await writeAudit(db, req, {
    action: `admin.appointment.${action}`,
    entity: 'appointments',
    entityId: id,
    metadata: { action, ...updates },
  });
  return { id, ...updates };
}

async function listHospitals(query = {}) {
  const db = await getDb();
  const [facilityLocations, users, doctors, patients, screenings, appointments] = await Promise.all([
    db.collection('facility_locations').find({}).toArray(),
    db.collection('users').find({ deleted_at: null }).toArray(),
    db.collection('doctors').find({}).toArray(),
    db.collection('patients').find({ deleted_at: null }).toArray(),
    db.collection('oral_screenings').find({ deleted_at: null }).toArray(),
    db.collection('appointments').find({ deleted_at: null }).toArray(),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const patientById = new Map(patients.map((p) => [p.id, p]));

  let active = 0, inactive = 0, pending = 0, rejected = 0;

  const items = facilityLocations.map((f) => {
    const nameLower = f.name.toLowerCase();
    const manager = f.manager_user_id ? userById.get(f.manager_user_id) : null;
    const accountStatus = f.account_status || (f.verification_status === 'unverified' ? 'pending_approval' : (f.is_active ? 'active' : 'inactive'));

    if (accountStatus === 'active') active += 1;
    else if (accountStatus === 'inactive') inactive += 1;
    else if (accountStatus === 'pending_approval') pending += 1;
    else if (accountStatus === 'rejected') rejected += 1;

    const assignedDoctors = doctors.filter((d) => {
      return (f.doctor_user_ids || []).includes(d.user_id) || (f.doctor_user_ids || []).includes(d.id);
    }).length;

    const facPatients = patients.filter((p) => {
      return [p.phc_name, p.hospital_name, p.facility_name]
        .some((val) => String(val || '').toLowerCase() === nameLower);
    }).length;

    const facScreenings = screenings.filter((s) => {
      const p = patientById.get(s.patient_id);
      return [p?.phc_name, p?.hospital_name, p?.facility_name]
        .some((val) => String(val || '').toLowerCase() === nameLower);
    }).length;

    const facAppointments = appointments.filter((a) => {
      return a.facility_id === f.id || String(a.facility_name || '').toLowerCase() === nameLower;
    }).length;

    return {
      id: f.id,
      name: f.name,
      area: f.area || 'ITDA Paderu Region',
      facility_type: f.facility_type || 'phc',
      verification_status: f.verification_status || 'verified',
      is_active: f.is_active !== false,
      account_status: accountStatus,
      manager: manager ? {
        id: manager.id,
        full_name: manager.full_name,
        email: manager.email,
        mobile: manager.mobile,
      } : null,
      total_doctors: assignedDoctors,
      total_patients: facPatients,
      total_screenings: facScreenings,
      total_appointments: facAppointments,
      registration_date: f.created_at || new Date('2026-01-01'),
      created_at: f.created_at,
    };
  });

  let filtered = items;
  if (query.search) {
    const s = query.search.toLowerCase();
    filtered = filtered.filter((i) => i.name.toLowerCase().includes(s) || i.area.toLowerCase().includes(s));
  }
  if (query.status && query.status !== 'all') {
    filtered = filtered.filter((i) => i.account_status === query.status);
  }
  if (query.type && query.type !== 'all') {
    filtered = filtered.filter((i) => i.facility_type === query.type);
  }

  return {
    metrics: {
      totalRegisteredFacilities: facilityLocations.length,
      activeFacilities: active,
      inactiveFacilities: inactive,
      pendingRegistrations: pending,
      rejectedRegistrations: rejected,
    },
    items: filtered,
  };
}

async function updateFacilityStatus(id, { status, reason }, req) {
  const db = await getDb();
  const collection = db.collection('facility_locations');
  const facility = await collection.findOne({ id });
  if (!facility) throw httpError(404, 'FACILITY_NOT_FOUND', 'Facility not found');
  const isActive = status === 'active';
  const now = new Date();
  await collection.updateOne(
    { id },
    {
      $set: {
        account_status: status,
        is_active: isActive,
        status_reason: reason || null,
        updated_at: now,
      },
    }
  );
  await writeAudit(db, req, {
    action: 'admin.facility.status_updated',
    entity: 'facility_locations',
    entityId: id,
    metadata: { status, reason, previous_status: facility.account_status },
  });
  const updated = await collection.findOne({ id });
  delete updated._id;
  return updated;
}

async function assignFacilityManager(id, { manager_user_id }, req) {
  const db = await getDb();
  const collection = db.collection('facility_locations');
  const facility = await collection.findOne({ id });
  if (!facility) throw httpError(404, 'FACILITY_NOT_FOUND', 'Facility not found');
  if (manager_user_id) {
    const user = await db.collection('users').findOne({ id: manager_user_id, role: 'admin', is_active: true, deleted_at: null });
    if (!user) throw httpError(422, 'INVALID_MANAGER', 'Selected manager is not an active administrator');
  }
  const now = new Date();
  await collection.updateOne({ id }, { $set: { manager_user_id: manager_user_id || null, updated_at: now } });
  await writeAudit(db, req, {
    action: 'admin.facility.manager_assigned',
    entity: 'facility_locations',
    entityId: id,
    metadata: { manager_user_id },
  });
  const updated = await collection.findOne({ id });
  delete updated._id;
  return updated;
}

async function listManagers(query = {}) {
  const db = await getDb();
  const [users, facilities, auditLogs] = await Promise.all([
    db.collection('users').find({ role: 'admin', deleted_at: null }).toArray(),
    db.collection('facility_locations').find({}).toArray(),
    db.collection('audit_logs').find({}).sort({ created_at: -1 }).toArray(),
  ]);

  const facilityByManager = new Map();
  for (const f of facilities) {
    if (f.manager_user_id) {
      if (!facilityByManager.has(f.manager_user_id)) facilityByManager.set(f.manager_user_id, []);
      facilityByManager.get(f.manager_user_id).push(f);
    }
  }

  let active = 0, inactive = 0, pending = 0;

  const items = users.map((u) => {
    const isPending = u.admin_registration_status === 'pending' || Boolean(u.pending_approval);
    const status = isPending ? 'pending' : (u.is_active ? 'active' : 'inactive');
    if (status === 'active') active += 1;
    else if (status === 'inactive') inactive += 1;
    else if (status === 'pending') pending += 1;

    const assigned = facilityByManager.get(u.id) || [];
    const lastAudit = auditLogs.find((a) => a.user_id === u.id);

    return {
      id: u.id,
      full_name: u.full_name,
      username: u.username || null,
      admin_id: u.admin_id || null,
      email: u.email,
      mobile: u.mobile,
      is_active: u.is_active,
      status,
      assigned_facilities: assigned.map((f) => ({ id: f.id, name: f.name, facility_type: f.facility_type })),
      last_active: lastAudit?.created_at || u.last_login_at || u.created_at,
      created_at: u.created_at,
    };
  });

  let filtered = items;
  if (query.search) {
    const s = query.search.toLowerCase();
    filtered = filtered.filter((m) => m.full_name.toLowerCase().includes(s) || (m.email || '').toLowerCase().includes(s) || (m.mobile || '').includes(s));
  }
  if (query.status && query.status !== 'all') {
    filtered = filtered.filter((m) => m.status === query.status);
  }

  return {
    metrics: {
      totalHospitalManagers: users.length,
      activeManagers: active,
      pendingManagers: pending,
      inactiveManagers: inactive,
    },
    items: filtered,
  };
}

async function listDoctors(query = {}) {
  const db = await getDb();
  const [users, doctorProfiles, appointments, screenings, facilities] = await Promise.all([
    db.collection('users').find({ role: 'doctor', deleted_at: null }).toArray(),
    db.collection('doctors').find({}).toArray(),
    db.collection('appointments').find({ deleted_at: null }).toArray(),
    db.collection('oral_screenings').find({ deleted_at: null }).toArray(),
    db.collection('facility_locations').find({}).toArray(),
  ]);

  const profileByUserId = new Map(doctorProfiles.map((p) => [p.user_id, p]));
  const facilityById = new Map(facilities.map((f) => [f.id, f]));

  let active = 0, inactive = 0, pending = 0;

  const items = users.map((u) => {
    const profile = profileByUserId.get(u.id) || {};
    const isPending = u.doctor_request_status === 'pending';
    const status = isPending ? 'pending' : (u.is_active ? 'active' : 'inactive');
    if (status === 'active') active += 1;
    else if (status === 'inactive') inactive += 1;
    else if (status === 'pending') pending += 1;

    const doctorAppts = appointments.filter((a) => a.doctor_id === profile.id || a.doctor_id === u.id);
    const activeWorkload = doctorAppts.filter((a) => ['booked', 'rescheduled', 'pending'].includes(a.status)).length;
    const assignedScreenings = screenings.filter((s) => s.assigned_doctor_id === profile.id || s.assigned_doctor_id === u.id).length;
    const assignedFacility = profile.hospital_id ? facilityById.get(profile.hospital_id) : (profile.phc_id ? facilityById.get(profile.phc_id) : null);

    return {
      id: u.id,
      doctor_id: profile.id || null,
      full_name: u.full_name,
      email: u.email,
      mobile: u.mobile,
      specialization: profile.specialty || 'General Dentist',
      qualification: profile.qualification || 'BDS',
      registration_number: profile.registration_number || 'N/A',
      facility: assignedFacility?.name || profile.facility_name || 'Community Health Clinic',
      facility_id: assignedFacility?.id || profile.hospital_id || profile.phc_id || null,
      availability: profile.availability || { 1: ['09:00', '10:00', '11:00'], 2: ['09:00', '10:00'], 3: ['09:00', '10:00', '11:00'] },
      workload: {
        active_appointments: activeWorkload,
        total_appointments: doctorAppts.length,
        screening_follow_ups: assignedScreenings,
      },
      status,
      doctor_request_status: u.doctor_request_status || 'approved',
      created_at: u.created_at,
    };
  });

  let filtered = items;
  if (query.search) {
    const s = query.search.toLowerCase();
    filtered = filtered.filter((d) => d.full_name.toLowerCase().includes(s) || (d.email || '').toLowerCase().includes(s) || d.specialization.toLowerCase().includes(s));
  }
  if (query.status && query.status !== 'all') {
    filtered = filtered.filter((d) => d.status === query.status);
  }

  return {
    metrics: {
      totalDoctors: users.length,
      activeDoctors: active,
      inactiveDoctors: inactive,
      pendingDoctorApprovals: pending,
    },
    items: filtered,
  };
}

async function listPatients(query = {}, role = 'admin') {
  const db = await getDb();
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  const [patients, screenings, results] = await Promise.all([
    db.collection('patients').find({ deleted_at: null }).toArray(),
    db.collection('oral_screenings').find({ deleted_at: null }).toArray(),
    db.collection('ai_screening_results').find({}).toArray(),
  ]);

  const screeningsByPatient = new Map();
  for (const s of screenings) {
    if (!screeningsByPatient.has(s.patient_id)) screeningsByPatient.set(s.patient_id, []);
    screeningsByPatient.get(s.patient_id).push(s);
  }
  const resultByScreening = new Map();
  for (const r of results) {
    if (!resultByScreening.has(r.screening_id)) resultByScreening.set(r.screening_id, r);
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  let newPatients = 0, activePatients = 0, requiringFollowUp = 0, highRisk = 0;

  const items = patients.map((p) => {
    const pCreated = dateValue(p.created_at);
    if (pCreated >= thirtyDaysAgo) newPatients += 1;
    if (p.is_active) activePatients += 1;

    const pScreenings = screeningsByPatient.get(p.id) || [];
    pScreenings.sort((a, b) => new Date(b.screened_at || b.created_at) - new Date(a.screened_at || a.created_at));
    const latestScreening = pScreenings[0];
    const latestResult = latestScreening ? resultByScreening.get(latestScreening.id) : null;
    const risk = String(latestResult?.risk_category || 'normal').toLowerCase();

    const needsFollowUp = latestScreening?.follow_up_date || latestScreening?.follow_up_status === 'needs_follow_up' || risk === 'high' || risk === 'critical';
    if (needsFollowUp) requiringFollowUp += 1;
    if (risk === 'high' || risk === 'critical' || risk === 'urgent') highRisk += 1;

    const birth = p.date_of_birth ? new Date(p.date_of_birth) : null;
    const age = birth && !Number.isNaN(birth.getTime())
      ? Math.max(0, Math.floor((Date.now() - birth.getTime()) / 31557600000))
      : null;

    return {
      id: p.id,
      patient_code: p.patient_code || p.id,
      full_name: role === 'super_admin' ? p.full_name : `${p.full_name?.slice(0, 1) || 'P'}***`,
      age,
      gender: p.gender || 'Unknown',
      mobile: role === 'super_admin' ? p.mobile : '**********',
      hospital: p.phc_name || p.hospital_name || p.facility_name || 'Community PHC',
      registration_date: p.created_at,
      screening_count: pScreenings.length,
      last_screening: latestScreening?.screened_at || latestScreening?.created_at || null,
      follow_up_status: latestScreening?.follow_up_status || (needsFollowUp ? 'needs_follow_up' : 'none'),
      risk_level: risk,
    };
  });

  let filtered = items;
  if (query.search) {
    const s = query.search.toLowerCase();
    filtered = filtered.filter((p) => p.patient_code.toLowerCase().includes(s) || p.hospital.toLowerCase().includes(s) || p.full_name.toLowerCase().includes(s));
  }
  if (query.risk && query.risk !== 'all') {
    filtered = filtered.filter((p) => p.risk_level === query.risk.toLowerCase());
  }
  if (query.facility) {
    filtered = filtered.filter((p) => p.hospital.toLowerCase().includes(query.facility.toLowerCase()));
  }

  filtered.sort((a, b) => new Date(b.registration_date) - new Date(a.registration_date));

  return {
    metrics: {
      totalPatients: patients.length,
      newPatients,
      activePatients,
      requiringFollowUp,
      highRiskPatients: highRisk,
    },
    items: filtered.slice((page - 1) * limit, page * limit),
    meta: {
      page,
      limit,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / limit) || 1,
    },
  };
}

async function listRegistrations(_query = {}) {
  const db = await getDb();
  const [users, facilities] = await Promise.all([
    db.collection('users').find({ deleted_at: null }).toArray(),
    db.collection('facility_locations').find({}).toArray(),
  ]);

  const pendingDoctors = users.filter((u) => u.role === 'doctor' && u.doctor_request_status === 'pending');
  const pendingAdmins = users.filter((u) => u.role === 'admin' && (u.admin_registration_status === 'pending' || u.pending_approval));
  const unverifiedFacilities = facilities.filter((f) => f.verification_status === 'unverified' || f.account_status === 'pending_approval');
  const recentFacilities = [...facilities].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);

  return {
    metrics: {
      newHospitalRegistrations: unverifiedFacilities.length,
      pendingApprovals: pendingDoctors.length + pendingAdmins.length + unverifiedFacilities.length,
      approvedRegistrations: users.filter((u) => u.is_active && !u.pending_approval).length,
      rejectedRegistrations: users.filter((u) => u.doctor_request_status === 'rejected' || u.admin_registration_status === 'rejected').length,
    },
    pendingDoctors: pendingDoctors.map(userSummary),
    pendingAdmins: pendingAdmins.map(userSummary),
    pendingFacilities: unverifiedFacilities,
    recentlyAddedFacilities: recentFacilities,
  };
}

async function listActivities(query = {}) {
  const db = await getDb();
  const limit = Math.min(100, Math.max(1, Number(query.limit || 30)));
  const [auditLogs, users] = await Promise.all([
    db.collection('audit_logs').find({}).sort({ created_at: -1 }).limit(limit).toArray(),
    db.collection('users').find({}).toArray(),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));

  const items = auditLogs.map((log) => {
    const actor = userById.get(log.user_id);
    let title = log.action;
    let type = 'general';
    if (log.action.includes('screening')) { type = 'screening'; title = 'Oral Screening Activity'; }
    else if (log.action.includes('doctor')) { type = 'doctor'; title = 'Doctor Account Event'; }
    else if (log.action.includes('admin') || log.action.includes('facility')) { type = 'facility'; title = 'Facility & Admin Event'; }
    else if (log.action.includes('appointment')) { type = 'appointment'; title = 'Appointment Event'; }
    else if (log.action.includes('patient')) { type = 'patient'; title = 'Patient Record Event'; }

    return {
      id: log.id,
      action: log.action,
      type,
      title,
      actor_name: actor ? actor.full_name : 'System Administrator',
      actor_role: actor ? actor.role : 'super_admin',
      entity: log.entity,
      entity_id: log.entity_id,
      metadata: log.metadata || {},
      created_at: log.created_at,
    };
  });

  return { items };
}

function makeScreeningTrend(rows) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
    const key = date.toISOString().slice(0, 7);
    return { month: key, screenings: 0 };
  });
  const counts = new Map(months.map((item) => [item.month, 0]));
  for (const row of rows) {
    const date = dateValue(row.created_at);
    if (!Number.isNaN(date.getTime())) {
      const key = date.toISOString().slice(0, 7);
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    }
  }
  return months.map((item) => ({ ...item, screenings: counts.get(item.month) }));
}

async function listFacilityDirectory(search = '') {
  const db = await getDb();
  const filter = search
    ? { $or: [{ name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { area: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }] }
    : {};
  const items = await db.collection('facility_locations').find(filter).sort({ name: 1 }).toArray();
  return items.map(({ _id, ...item }) => item);
}

async function createFacilityDirectoryEntry(input, req) {
  const db = await getDb();
  if (input.manager_user_id && !await db.collection('users').findOne({ id: input.manager_user_id, role: 'admin', is_active: true, deleted_at: null })) {
    throw httpError(422, 'INVALID_FACILITY_MANAGER', 'Select an active administrator as the facility manager');
  }
  const nameKey = input.name.trim().toLocaleLowerCase('en');
  const existing = await db.collection('facility_locations').findOne({ name_key: nameKey });
  if (existing) throw httpError(409, 'FACILITY_EXISTS', 'A location with this name already exists');
  const now = new Date();
  const item = { id: randomUUID(), ...input, name: input.name.trim(), name_key: nameKey, created_at: now, updated_at: now };
  await db.collection('facility_locations').insertOne(item);
  await writeAudit(db, req, { action: 'admin.facility.created', entity: 'facility_locations', entityId: item.id, metadata: { name: item.name } });
  delete item._id;
  return item;
}

async function updateFacilityDirectoryEntry(id, input, req) {
  const db = await getDb();
  const collection = db.collection('facility_locations');
  const current = await collection.findOne({ id });
  if (!current) throw httpError(404, 'FACILITY_NOT_FOUND', 'Facility location not found');
  const updates = { ...input, updated_at: new Date() };
  if (input.name) {
    updates.name = input.name.trim();
    updates.name_key = updates.name.toLocaleLowerCase('en');
    const duplicate = await collection.findOne({ name_key: updates.name_key, id: { $ne: id } });
    if (duplicate) throw httpError(409, 'FACILITY_EXISTS', 'A location with this name already exists');
  }
  if (input.manager_user_id && !await db.collection('users').findOne({ id: input.manager_user_id, role: 'admin', is_active: true, deleted_at: null })) {
    throw httpError(422, 'INVALID_FACILITY_MANAGER', 'Select an active administrator as the facility manager');
  }
  await collection.updateOne({ id }, { $set: updates });
  await writeAudit(db, req, { action: 'admin.facility.updated', entity: 'facility_locations', entityId: id, metadata: { fields: Object.keys(input) } });
  const result = await collection.findOne({ id });
  delete result._id;
  return result;
}

async function listRoles() {
  const db = await getDb();
  const roles = await db
    .collection('roles')
    .find({ name: { $in: ROLE_NAMES } })
    .sort({ name: 1 })
    .toArray();
  const roleByName = new Map(roles.map((role) => [role.name, role]));
  return {
    permissions: PERMISSIONS,
    roles: ROLE_NAMES.map((name) => {
      const role = roleByName.get(name);
      return {
        name,
        description: role?.description || name,
        permissions: role?.permissions || [],
        permissions_version: role?.permissions_version || 1,
        is_system: true,
        editable: name !== 'super_admin',
      };
    }),
  };
}

async function updateRolePermissions(name, permissions, req) {
  if (req.user.role !== 'super_admin') {
    throw httpError(403, 'FORBIDDEN', 'Only super administrators can manage role permissions');
  }
  if (name === 'super_admin') {
    throw httpError(
      409,
      'SUPER_ADMIN_PERMISSIONS_LOCKED',
      'Super administrator permissions cannot be reduced',
    );
  }
  const uniquePermissions = [...new Set(permissions)];
  if (uniquePermissions.some((permission) => !ALL_PERMISSIONS.includes(permission))) {
    throw httpError(422, 'UNKNOWN_PERMISSION', 'One or more permissions are not recognized');
  }
  const db = await getDb();
  const roles = db.collection('roles');
  const current = await roles.findOne({ name });
  if (!current) throw httpError(404, 'ROLE_NOT_FOUND', 'Role not found');
  const nextVersion = Number(current.permissions_version || 1) + 1;
  const now = new Date();
  const updated = await roles.updateOne(
    { name, permissions_version: current.permissions_version || 1 },
    {
      $set: {
        permissions: uniquePermissions,
        permissions_version: nextVersion,
        permission_catalog_version: PERMISSION_CATALOG_VERSION,
        updated_at: now,
      },
    },
  );
  if (updated.modifiedCount !== 1) {
    throw httpError(
      409,
      'ROLE_PERMISSIONS_CHANGED',
      'Role permissions changed; reload and try again',
    );
  }
  const roleUsers = await db
    .collection('users')
    .find({ role: name, deleted_at: null }, { projection: { id: 1 } })
    .toArray();
  const userIds = roleUsers.map((user) => user.id);
  if (userIds.length) {
    await Promise.all([
      db
        .collection('users')
        .updateMany(
          { id: { $in: userIds } },
          { $set: { permissions_version: nextVersion, updated_at: now } },
        ),
      db
        .collection('refresh_tokens')
        .updateMany({ user_id: { $in: userIds }, revoked_at: null }, { $set: { revoked_at: now } }),
    ]);
  }
  const previousPermissions = current.permissions || [];
  await writeAudit(db, req, {
    action: 'admin.roles.permissions_updated',
    entity: 'roles',
    entityId: name,
    metadata: {
      added: uniquePermissions.filter((permission) => !previousPermissions.includes(permission)),
      removed: previousPermissions.filter((permission) => !uniquePermissions.includes(permission)),
      affected_users: userIds.length,
      permissions_version: nextVersion,
    },
  });
  return {
    name,
    description: current.description || name,
    permissions: uniquePermissions,
    permissions_version: nextVersion,
    is_system: true,
    editable: true,
  };
}

async function createProfile(db, userId, role, profile) {
  const now = new Date();
  const collectionByRole = {
    doctor: 'doctors',
    health_worker: 'health_workers',
    specialist: 'specialists',
  };
  const collectionName = collectionByRole[role];
  if (!collectionName) return;
  if (role === 'doctor' && !profile.registration_number) {
    throw httpError(422, 'PROFILE_REQUIRED', 'Doctor registration number is required');
  }
  if (role === 'health_worker' && !profile.worker_code) {
    throw httpError(422, 'PROFILE_REQUIRED', 'Health worker code is required');
  }
  if (role === 'specialist' && (!profile.registration_number || !profile.specialty)) {
    throw httpError(
      422,
      'PROFILE_REQUIRED',
      'Specialist registration number and specialty are required',
    );
  }
  const fields =
    role === 'doctor'
      ? [
          'registration_number',
          'qualification',
          'specialty',
          'facility_name',
          'district',
          'phc_id',
          'hospital_id',
          'availability',
        ]
      : role === 'health_worker'
        ? ['worker_code', 'village_id', 'phc_id']
        : ['registration_number', 'specialty', 'hospital_id'];
  const value = { user_id: userId, updated_at: now };
  for (const field of fields)
    value[field] = profile[field] ?? (field === 'qualification' ? '' : null);
  await db
    .collection(collectionName)
    .updateOne(
      { user_id: userId },
      { $set: value, $setOnInsert: { id: randomUUID(), created_at: now } },
      { upsert: true },
    );
}

async function createUser(input, req) {
  if (input.role === 'super_admin') {
    throw httpError(
      403,
      'SUPER_ADMIN_SETUP_ONLY',
      'Super Admin accounts can only be created through the one-time setup script',
    );
  }
  if (input.role === 'patient') {
    throw httpError(
      403,
      'FORBIDDEN',
      'Patient accounts are records only and cannot be created as login users',
    );
  }
  if (
    req.user.role !== 'super_admin' &&
    !['doctor', 'health_worker', 'specialist'].includes(input.role)
  ) {
    throw httpError(
      403,
      'FORBIDDEN',
      'Administrators may create doctor, health worker, or specialist accounts only',
    );
  }
  if (input.role === 'admin' && req.user.role !== 'super_admin') {
    throw httpError(403, 'FORBIDDEN', 'Only a Super Admin can create administrator accounts');
  }
  const username = input.role === 'admin' ? input.username.trim().toLowerCase() : undefined;
  const adminId =
    input.role === 'admin' ? (input.admin_id || username).trim().toUpperCase() : undefined;
  const db = await getDb();
  if (username) {
    const existingUsername = await db.collection('users').findOne({ username, deleted_at: null });
    if (existingUsername)
      throw httpError(409, 'ADMIN_USERNAME_EXISTS', 'This username is already registered');
  }
  if (adminId) {
    const existingAdminId = await db
      .collection('users')
      .findOne({ admin_id: adminId, deleted_at: null });
    if (existingAdminId)
      throw httpError(409, 'ADMIN_ID_EXISTS', 'This Admin ID is already registered');
  }
  const role = await db.collection('roles').findOne({ name: input.role });
  if (!role) throw httpError(422, 'ROLE_NOT_FOUND', 'Requested role is not configured');
  const now = new Date();
  const user = {
    id: randomUUID(),
    full_name: input.full_name,
    email: input.email ? input.email.toLowerCase() : null,
    ...(username ? { username } : {}),
    ...(adminId ? { admin_id: adminId } : {}),
    mobile: input.mobile,
    password_hash: await bcrypt.hash(input.password, 12),
    preferred_language: input.preferred_language,
    role: input.role,
    is_active: input.role === 'admin' ? false : true,
    ...(input.role === 'doctor' ? { doctor_request_status: 'approved' } : {}),
    ...(input.role === 'admin'
      ? {
          admin_registration_status: 'pending',
          admin_requested_at: now,
          admin_requested_by: req.user.sub,
        }
      : {}),
    deleted_at: null,
    must_change_password: false,
    failed_login_count: 0,
    permissions_version: role.permissions_version || 1,
    created_at: now,
    updated_at: now,
  };
  try {
    await db.collection('users').insertOne(user);
    await createProfile(db, user.id, input.role, input.profile || {}, {
      ...user,
      created_by: req.user.sub,
    });
    await notificationService.create(
      db,
      user.id,
      'registration_confirmation',
      { synthetic: true },
      { type: 'registration' },
    );
    await writeAudit(db, req, {
      action: input.role === 'admin' ? 'admin.admin.registration_requested' : 'admin.users.create',
      entity: 'users',
      entityId: user.id,
      metadata: { role: input.role, ...(adminId ? { admin_id: adminId } : {}) },
    });
    return {
      ...userSummary({
        ...user,
        created_by: req.user.sub,
        pending_approval: input.role === 'admin',
      }),
      permissions: role.permissions || [],
    };
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.username) {
      throw httpError(409, 'ADMIN_USERNAME_EXISTS', 'This username is already registered');
    }
    if (error.code === 11000 && error.keyPattern?.admin_id) {
      throw httpError(409, 'ADMIN_ID_EXISTS', 'This Admin ID is already registered');
    }
    if (error.code === 11000)
      throw httpError(409, 'ACCOUNT_EXISTS', 'Mobile, email, or profile identifier already exists');
    throw error;
  }
}

function pendingDoctor(user, auditLogs) {
  if (user.role === 'doctor' && user.doctor_request_status) {
    return user.doctor_request_status === 'pending';
  }
  return (
    user.role === 'doctor' &&
    !user.is_active &&
    auditLogs.some(
      (log) => log.user_id === user.id && log.action === 'auth.doctor.registration_requested',
    ) &&
    !auditLogs.some(
      (log) =>
        log.entity === 'users' &&
        log.entity_id === user.id &&
        ['admin.doctor.registration_approved', 'admin.doctor.registration_rejected'].includes(
          log.action,
        ),
    )
  );
}

function pendingApproval(user, auditLogs) {
  if (user.role === 'doctor') return pendingDoctor(user, auditLogs);
  if (user.role === 'admin') return user.admin_registration_status === 'pending';
  return Boolean(user.pending_approval);
}

const listSorts = {
  name: 'full_name',
  role: 'role',
  status: 'is_active',
  created_at: 'created_at',
  mobile: 'mobile',
};

async function listUsers(filters, pagination) {
  const db = await getDb();
  const [users, auditLogs, patients, doctors, workers, specialists, villages, phcs, hospitals] =
    await Promise.all([
      db.collection('users').find({
        $or: [
          { deleted_at: null },
          { role: 'patient', deleted_at: { $ne: null } },
        ],
      }).toArray(),
      db.collection('audit_logs').find({}).sort({ created_at: 1 }).toArray(),
      db.collection('patients').find({ deleted_at: null }).toArray(),
      db.collection('doctors').find({}).toArray(),
      db.collection('health_workers').find({}).toArray(),
      db.collection('specialists').find({}).toArray(),
      db.collection('villages').find({}).toArray(),
      db.collection('phcs').find({}).toArray(),
      db.collection('hospitals').find({}).toArray(),
    ]);
  const profiles = [...patients, ...doctors, ...workers, ...specialists];
  const byUser = new Map(profiles.map((profile) => [profile.user_id, profile]));
  const villageMap = new Map(villages.map((item) => [item.id, item]));
  const phcMap = new Map(phcs.map((item) => [item.id, item]));
  const hospitalMap = new Map(hospitals.map((item) => [item.id, item]));
  const result = users
    .map((user) => {
      const profile = byUser.get(user.id) || {};
      const history = auditLogs.find(
        (log) =>
          (log.entity === 'users' &&
            log.entity_id === user.id &&
            log.action === 'admin.users.create') ||
          (['auth.register.success', 'auth.doctor.registration_requested'].includes(log.action) &&
            log.user_id === user.id),
      );
      const creator = history && users.find((item) => item.id === history.user_id);
      const pending = pendingApproval(user, auditLogs);
      return {
        ...user,
        role: user.role,
        pending_approval: pending,
        created_by: creator?.full_name || null,
        __profile: profile,
        __village: villageMap.get(profile.village_id),
        __phc: phcMap.get(profile.phc_id),
        __hospital: hospitalMap.get(profile.hospital_id),
      };
    })
    .filter((user) => {
      const profile = user.__profile;
      if (user.deleted_at && (user.role !== 'patient' || !profile.id)) return false;
      if (filters.search) {
        const term = filters.search.toLowerCase();
        if (
          ![user.full_name, user.mobile, user.email, user.username, user.admin_id].some((value) =>
            String(value || '')
              .toLowerCase()
              .includes(term),
          )
        )
          return false;
      }
      if (filters.role && user.role !== filters.role) return false;
      if (filters.status === 'active' && !user.is_active) return false;
      if (filters.status === 'inactive' && user.is_active) return false;
      if (filters.status === 'pending' && !user.pending_approval) return false;
      if (
        filters.status === 'rejected' &&
        !['rejected'].includes(user.doctor_request_status) &&
        !['rejected'].includes(user.admin_registration_status)
      )
        return false;
      if (
        filters.district &&
        ![
          profile.district,
          user.__village?.district,
          user.__phc?.district,
          user.__hospital?.district,
        ].some((value) => matchesDistrict({ district: value }, filters.district))
      )
        return false;
      if (filters.phc && ![profile.phc_id].includes(filters.phc)) return false;
      if (filters.hospital && profile.hospital_id !== filters.hospital) return false;
      return true;
    });
  const field = listSorts[filters.sort] || 'created_at';
  const direction = filters.order?.toLowerCase() === 'asc' ? 1 : -1;
  result.sort((left, right) => {
    const a = left[field];
    const b = right[field];
    const comparison =
      typeof a === 'string' && typeof b === 'string'
        ? a.localeCompare(b)
        : typeof a === 'boolean' && typeof b === 'boolean'
          ? Number(a) - Number(b)
          : dateValue(a || 0).getTime() - dateValue(b || 0).getTime();
    return comparison * direction || String(left.id).localeCompare(String(right.id));
  });
  const total = result.length;
  return {
    items: result.slice(pagination.offset, pagination.offset + pagination.limit).map(userSummary),
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
    },
  };
}

async function getUser(id) {
  const db = await getDb();
  let user = await db.collection('users').findOne({ id, deleted_at: null });
  if (!user) {
    user = await db.collection('users').findOne({
      id,
      role: 'patient',
      deleted_at: { $ne: null },
    });
  }
  if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found');
  const [auditLogs, profileCollection] = await Promise.all([
    db
      .collection('audit_logs')
      .find({
        $or: [{ user_id: id }, { entity: 'users', entity_id: id }],
      })
      .sort({ created_at: -1 })
      .toArray(),
    db
      .collection(
        {
          doctor: 'doctors',
          health_worker: 'health_workers',
          specialist: 'specialists',
          patient: 'patients',
        }[user.role] || 'none',
      )
      .findOne({ user_id: id, ...(user.role === 'patient' ? { deleted_at: null } : {}) }),
  ]);
  if (user.deleted_at && !profileCollection) throw httpError(404, 'USER_NOT_FOUND', 'User not found');
  const role = await db.collection('roles').findOne({ name: user.role });
  let profile = profileCollection;
  if (profile) {
    const [village, phc, hospital] = await Promise.all([
      profile.village_id ? db.collection('villages').findOne({ id: profile.village_id }) : null,
      profile.phc_id ? db.collection('phcs').findOne({ id: profile.phc_id }) : null,
      profile.hospital_id ? db.collection('hospitals').findOne({ id: profile.hospital_id }) : null,
    ]);
    profile = {
      ...profile,
      ...(village ? { village_name: village.name } : {}),
      ...(phc ? { phc_name: phc.name } : {}),
      ...(hospital ? { hospital_name: hospital.name } : {}),
    };
    delete profile._id;
    delete profile.user_id;
    delete profile.created_at;
    delete profile.updated_at;
  }
  const request = auditLogs
    .filter(
      (log) =>
        ['auth.register.success', 'auth.doctor.registration_requested'].includes(log.action) ||
        log.action === 'admin.users.create',
    )
    .sort((a, b) => dateValue(a.created_at) - dateValue(b.created_at));
  const actorIds = [...new Set(auditLogs.map((log) => log.user_id).filter(Boolean))];
  const actors = await db
    .collection('users')
    .find({ id: { $in: actorIds } })
    .toArray();
  const actorMap = new Map(actors.map((item) => [item.id, item.full_name]));
  const history = request.map((log) => ({
    action: log.action,
    created_at: log.created_at,
    created_by: actorMap.get(log.user_id) || null,
  }));
  const recentActivity = auditLogs.slice(0, 20).map((log) => ({
    id: log.id,
    action: log.action,
    entity: log.entity,
    entity_id: log.entity_id,
    metadata: log.metadata,
    created_at: log.created_at,
    actor_name: actorMap.get(log.user_id) || null,
  }));
  return {
    ...userSummary({ ...user, pending_approval: pendingApproval(user, auditLogs) }),
    permissions: role?.permissions || [],
    last_login_at: user.last_login_at,
    profile: profile || null,
    registrationHistory: history,
    recentActivity,
  };
}

function ensureCanManage(target, actor, nextRole) {
  if (actor.role === 'super_admin') return;
  if (
    ['super_admin', 'admin'].includes(target.role) ||
    ['admin', 'super_admin'].includes(nextRole)
  ) {
    throw httpError(403, 'FORBIDDEN', 'Administrators cannot manage administrator accounts');
  }
}

async function ensureNotLastSuperAdmin(db, userId) {
  const count = await db.collection('users').countDocuments({
    role: 'super_admin',
    is_active: true,
    deleted_at: null,
    id: { $ne: userId },
  });
  if (!count)
    throw httpError(
      409,
      'LAST_SUPER_ADMIN',
      'The last active super administrator cannot be deactivated or demoted',
    );
}

async function updateUser(id, input, req) {
  const db = await getDb();
  const users = db.collection('users');
  let current = await users.findOne({ id, deleted_at: null });
  let restoringDeletedPatient = false;
  if (!current && input.is_active === true) {
    const deletedPatient = await users.findOne({
      id,
      role: 'patient',
      deleted_at: { $ne: null },
    });
    if (deletedPatient) {
      const profile = await db.collection('patients').findOne({ user_id: id, deleted_at: null });
      if (!profile) throw httpError(404, 'USER_NOT_FOUND', 'User not found');
      current = deletedPatient;
      restoringDeletedPatient = true;
    }
  }
  if (!current) throw httpError(404, 'USER_NOT_FOUND', 'User not found');
  if (input.role === 'super_admin' && current.role !== 'super_admin') {
    throw httpError(
      403,
      'SUPER_ADMIN_SETUP_ONLY',
      'Super Admin accounts can only be created through the one-time setup script',
    );
  }
  ensureCanManage(current, req.user, input.role);
  if (
    current.role === 'doctor' &&
    input.is_active === true &&
    ['pending', 'rejected'].includes(current.doctor_request_status)
  ) {
    throw httpError(
      409,
      'DOCTOR_APPROVAL_REQUIRED',
      'Review the doctor registration request to activate this account',
    );
  }
  if (
    current.role === 'admin' &&
    input.is_active === true &&
    ['pending', 'rejected'].includes(current.admin_registration_status)
  ) {
    throw httpError(
      409,
      'ADMIN_APPROVAL_REQUIRED',
      'Review the administrator registration before activating this account',
    );
  }
  if (current.id === req.user.sub && input.is_active === false) {
    throw httpError(409, 'SELF_DEACTIVATION', 'You cannot deactivate your own account');
  }
  if (
    current.role === 'super_admin' &&
    current.is_active &&
    (input.is_active === false || (input.role && input.role !== 'super_admin'))
  ) {
    await ensureNotLastSuperAdmin(db, id);
  }
  const nextRole = input.role || current.role;
  let roleRecord;
  if (input.role && input.role !== current.role) {
    roleRecord = await db.collection('roles').findOne({ name: input.role });
    if (!roleRecord) throw httpError(422, 'ROLE_NOT_FOUND', 'Requested role is not configured');
  } else {
    roleRecord = await db.collection('roles').findOne({ name: nextRole });
  }
  const updates = {};
  for (const key of ['full_name', 'mobile', 'preferred_language', 'is_active']) {
    if (Object.hasOwn(input, key)) updates[key] = input[key];
  }
  if (restoringDeletedPatient) updates.deleted_at = null;
  if (Object.hasOwn(input, 'email'))
    updates.email = input.email === '' ? null : input.email?.toLowerCase() || null;
  if (input.role && input.role !== current.role) {
    updates.role = input.role;
    updates.permissions_version = roleRecord?.permissions_version || 1;
  }
  let temporaryPassword;
  if (input.reset_password) {
    temporaryPassword = `${randomBytes(9).toString('base64url')}Aa1`;
    updates.password_hash = await bcrypt.hash(temporaryPassword, 12);
    updates.must_change_password = true;
    updates.failed_login_count = 0;
    updates.locked_until = null;
  }
  if (Object.keys(updates).length) {
    updates.updated_at = new Date();
    try {
      await users.updateOne({ id }, { $set: updates });
    } catch (error) {
      if (error.code === 11000)
        throw httpError(
          409,
          'ACCOUNT_EXISTS',
          'Mobile, email, or profile identifier already exists',
        );
      throw error;
    }
    if (current.role === 'patient' && input.is_active === true) {
      await db.collection('patients').updateOne(
        { user_id: id, deleted_at: null },
        { $set: { is_active: true, updated_at: new Date() } },
      );
    }
  }
  if (
    input.is_active === false ||
    (input.role && input.role !== current.role) ||
    input.reset_password
  ) {
    await db
      .collection('refresh_tokens')
      .updateMany({ user_id: id, revoked_at: null }, { $set: { revoked_at: new Date() } });
  }
  if (input.profile && !['admin', 'super_admin'].includes(nextRole)) {
    const allowed =
      {
        doctor: ['registration_number', 'qualification', 'phc_id', 'hospital_id', 'availability'],
        health_worker: ['worker_code', 'village_id', 'phc_id'],
        specialist: ['registration_number', 'specialty', 'hospital_id'],
      }[nextRole] || [];
    if (nextRole !== current.role) {
      await createProfile(db, id, nextRole, input.profile, {
        ...current,
        full_name: input.full_name || current.full_name,
        mobile: input.mobile || current.mobile,
        created_by: req.user.sub,
      });
    } else {
      const profile = {};
      for (const key of allowed)
        if (Object.hasOwn(input.profile, key)) profile[key] = input.profile[key];
      if (Object.keys(profile).length) {
        await db
          .collection(
            { doctor: 'doctors', health_worker: 'health_workers', specialist: 'specialists' }[
              nextRole
            ],
          )
          .updateOne({ user_id: id }, { $set: { ...profile, updated_at: new Date() } });
      }
    }
  } else if (input.role && input.role !== current.role) {
    await createProfile(
      db,
      id,
      nextRole,
      {},
      {
        ...current,
        full_name: input.full_name || current.full_name,
        mobile: input.mobile || current.mobile,
        created_by: req.user.sub,
      },
    );
  }
  const updated = await users.findOne({ id });
  const auditLogs = await db.collection('audit_logs').find({}).toArray();
  const shouldApprove =
    current.role === 'doctor' &&
    current.is_active === false &&
    input.is_active === true &&
    pendingDoctor(current, auditLogs);
  await writeAudit(db, req, {
    action: restoringDeletedPatient
      ? 'admin.patient.account_reactivated'
      : input.reset_password
        ? 'admin.users.password_reset'
        : shouldApprove
          ? 'admin.doctor.registration_approved'
          : 'admin.users.update',
    entity: 'users',
    entityId: id,
    metadata: {
      fields: Object.keys(input).filter((key) => key !== 'password'),
      role: updated.role,
      active: updated.is_active,
      ...(restoringDeletedPatient ? { restored_from_soft_delete: true } : {}),
    },
  });
  return {
    user: {
      ...userSummary({
        ...updated,
        pending_approval: shouldApprove ? false : pendingApproval(updated, auditLogs),
      }),
      permissions: roleRecord?.permissions || [],
    },
    temporaryPassword,
  };
}

async function reviewDoctorRegistration(id, decision, req) {
  const db = await getDb();
  const users = db.collection('users');
  const current = await users.findOne({ id, role: 'doctor', deleted_at: null });
  if (!current)
    throw httpError(404, 'DOCTOR_REQUEST_NOT_FOUND', 'Doctor registration request not found');

  const history = current.doctor_request_status
    ? []
    : await db.collection('audit_logs').find({ user_id: id }).toArray();
  if (!pendingDoctor(current, history)) {
    throw httpError(
      409,
      'DOCTOR_REQUEST_ALREADY_REVIEWED',
      'Doctor registration request is no longer pending',
    );
  }

  const now = new Date();
  const update = await users.updateOne(
    {
      id,
      is_active: false,
      doctor_request_status: current.doctor_request_status || null,
    },
    {
      $set: {
        doctor_request_status: decision,
        is_active: decision === 'approved',
        updated_at: now,
        ...(decision === 'approved'
          ? { approved_at: now, approved_by: req.user.sub }
          : {
              rejected_at: now,
              rejected_by: req.user.sub,
            }),
      },
    },
  );
  if (update.modifiedCount !== 1) {
    throw httpError(
      409,
      'DOCTOR_REQUEST_ALREADY_REVIEWED',
      'Doctor registration request was reviewed by another administrator',
    );
  }
  if (decision === 'rejected') {
    await db
      .collection('refresh_tokens')
      .updateMany({ user_id: id, revoked_at: null }, { $set: { revoked_at: now } });
  }
  await writeAudit(db, req, {
    action: `admin.doctor.registration_${decision}`,
    entity: 'users',
    entityId: id,
    metadata: { decision },
  });
  const updated = await users.findOne({ id });
  return userSummary(updated);
}

async function reviewAdminRegistration(id, decision, req) {
  if (req.user.role !== 'super_admin') {
    throw httpError(403, 'FORBIDDEN', 'Only a Super Admin can review administrator registrations');
  }
  const db = await getDb();
  const users = db.collection('users');
  const current = await users.findOne({ id, role: 'admin', deleted_at: null });
  if (!current)
    throw httpError(404, 'ADMIN_REQUEST_NOT_FOUND', 'Administrator registration request not found');
  if (current.admin_registration_status !== 'pending') {
    throw httpError(
      409,
      'ADMIN_REQUEST_ALREADY_REVIEWED',
      'Administrator registration request is no longer pending',
    );
  }

  const now = new Date();
  const update = await users.updateOne(
    { id, role: 'admin', is_active: false, admin_registration_status: 'pending', deleted_at: null },
    {
      $set: {
        admin_registration_status: decision,
        is_active: decision === 'approved',
        updated_at: now,
        ...(decision === 'approved'
          ? { approved_at: now, approved_by: req.user.sub }
          : {
              rejected_at: now,
              rejected_by: req.user.sub,
            }),
      },
    },
  );
  if (update.modifiedCount !== 1) {
    throw httpError(
      409,
      'ADMIN_REQUEST_ALREADY_REVIEWED',
      'Administrator registration request was reviewed by another administrator',
    );
  }
  if (decision === 'rejected') {
    await db
      .collection('refresh_tokens')
      .updateMany({ user_id: id, revoked_at: null }, { $set: { revoked_at: now } });
  }
  await writeAudit(db, req, {
    action: `admin.admin.registration_${decision}`,
    entity: 'users',
    entityId: id,
    metadata: { decision, admin_id: current.admin_id },
  });
  return userSummary(await users.findOne({ id }));
}

async function deleteUser(id, req) {
  const db = await getDb();
  const user = await db.collection('users').findOne({ id, deleted_at: null });
  if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found');
  ensureCanManage(user, req.user);
  if (id === req.user.sub)
    throw httpError(409, 'SELF_DEACTIVATION', 'You cannot delete your own account');
  if (user.role === 'super_admin') await ensureNotLastSuperAdmin(db, id);
  const now = new Date();
  await db
    .collection('users')
    .updateOne({ id }, { $set: { is_active: false, deleted_at: now, updated_at: now } });
  await db
    .collection('refresh_tokens')
    .updateMany({ user_id: id, revoked_at: null }, { $set: { revoked_at: now } });
  await writeAudit(db, req, {
    action: 'admin.users.delete',
    entity: 'users',
    entityId: id,
    metadata: { soft_delete: true },
  });
}

const reportColumns = {
  users: ['id', 'full_name', 'email', 'mobile', 'role', 'is_active', 'created_at'],
  patients: ['id', 'patient_code', 'full_name', 'mobile', 'district', 'mandal', 'created_at'],
  appointments: ['id', 'patient_code', 'facility_type', 'scheduled_at', 'status', 'created_at'],
  referrals: ['id', 'patient_code', 'status', 'urgency', 'reason', 'created_at'],
  screenings: [
    'id',
    'patient_code',
    'status',
    'screened_at',
    'risk_category',
    'is_demo',
    'inference_status',
    'model_provider',
    'model_version',
    'analysis_timestamp',
    'disclaimer',
    'output_banner',
    'medical_limitations',
  ],
  emergency: ['id', 'patient_code', 'status', 'location_consent', 'created_at'],
  hospitals: ['id', 'name', 'area', 'facility_type', 'account_status', 'is_active', 'created_at'],
  risk_cases: ['id', 'patient_code', 'facility', 'risk_category', 'screening_date', 'assigned_doctor', 'follow_up_status', 'follow_up_date'],
  doctors: ['id', 'full_name', 'email', 'mobile', 'specialization', 'qualification', 'status', 'created_at'],
  facilities: ['id', 'name', 'area', 'facility_type', 'verification_status', 'is_active', 'created_at'],
  patient_follow_up: ['id', 'patient_code', 'facility', 'risk_category', 'follow_up_status', 'follow_up_date'],
};

function reportBounds(from, to) {
  const end = to ? new Date(`${to}T00:00:00.000Z`) : new Date();
  if (to) end.setUTCDate(end.getUTCDate() + 1);
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(0);
  if (end <= start) throw httpError(400, 'INVALID_DATE_RANGE', 'Report date range is invalid');
  return [start, end];
}

function csvEscape(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvReport(rows, type) {
  const headers = reportColumns[type];
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\r\n');
}

function makePdf(text) {
  const lines = text.split('\n').flatMap((line) => {
    const ascii = line.replace(/[^\x20-\x7e]/g, '?');
    const wrapped = [];
    for (let offset = 0; offset < ascii.length; offset += 110)
      wrapped.push(ascii.slice(offset, offset + 110));
    return wrapped.length ? wrapped : [''];
  });
  const pages = [];
  for (let offset = 0; offset < lines.length; offset += 50)
    pages.push(lines.slice(offset, offset + 50));
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  for (let index = 0; index < pages.length; index += 1) {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const operations = pages[index]
      .map((line, lineIndex) => `${lineIndex ? 'T* ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`)
      .join('\n');
    const stream = `BT /F1 8 Tf 40 760 Td 10 TL\n${operations}\nET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

async function report({ type, from, to, format }, req) {
  const db = await getDb();
  const [start, end] = reportBounds(from, to);
  const dateRows = async (collection, field = 'created_at', filter = {}) =>
    db
      .collection(collection)
      .find({
        ...filter,
        [field]: { $gte: start, $lt: end },
      })
      .sort({ [field]: -1 })
      .limit(5000)
      .toArray();
  const patientMap = new Map(
    (await db.collection('patients').find({}).toArray()).map((item) => [item.id, item]),
  );
  let rows = [];
  if (type === 'users') {
    const [users, roles] = await Promise.all([
      dateRows('users', 'created_at', { deleted_at: null }),
      db.collection('roles').find({}).toArray(),
    ]);
    rows = users
      .filter((item) => item.deleted_at == null)
      .map((item) => ({
        ...item,
        role: item.role || roles.find((role) => role.id === item.role_id)?.name,
      }));
  } else if (type === 'patients') {
    rows = (await dateRows('patients', 'created_at', { deleted_at: null })).filter(
      (item) => item.deleted_at == null,
    );
  } else if (type === 'appointments') {
    rows = (await dateRows('appointments', 'created_at', { deleted_at: null }))
      .filter((item) => item.deleted_at == null)
      .map((item) => ({ ...item, patient_code: patientMap.get(item.patient_id)?.patient_code }));
  } else if (type === 'referrals') {
    rows = (await dateRows('referrals')).map((item) => ({
      ...item,
      patient_code: patientMap.get(item.patient_id)?.patient_code,
    }));
  } else if (type === 'screenings') {
    const screenings = await dateRows('oral_screenings');
    const screeningIds = screenings.map((item) => item.id);
    const results = await db
      .collection('ai_screening_results')
      .find({ screening_id: { $in: screeningIds } })
      .sort({ created_at: -1 })
      .toArray();
    const aiMap = new Map();
    for (const result of results)
      if (!aiMap.has(result.screening_id)) aiMap.set(result.screening_id, result);
    rows = screenings.map((item) => {
      const ai = aiMap.get(item.id) || {};
      return {
        ...item,
        patient_code: patientMap.get(item.patient_id)?.patient_code,
        risk_category: null,
        is_demo: ai.is_demo,
        inference_status: ai.inference_status || (ai.is_demo ? 'not_performed' : 'unknown'),
        model_provider: ai.model_provider || null,
        model_version: ai.model_version || null,
        analysis_timestamp: ai.analysis_timestamp || ai.created_at,
        disclaimer: ai.disclaimer,
        output_banner: ai.is_demo
          ? 'DEMO AI OUTPUT - NOT FOR CLINICAL USE'
          : 'AI-ASSISTED PRELIMINARY SCREENING - NOT A DIAGNOSIS',
        medical_limitations:
          ai.result_data?.medical_limitations ||
          ai.result_data?.safety_sentence ||
          'Preliminary output only; a qualified clinician must assess the patient.',
      };
    });
  } else if (type === 'hospitals') {
    const facilities = await db.collection('facility_locations').find({}).toArray();
    rows = facilities.map((f) => ({
      id: f.id,
      name: f.name,
      area: f.area || 'ITDA Paderu',
      facility_type: f.facility_type,
      account_status: f.account_status || (f.is_active ? 'active' : 'inactive'),
      is_active: f.is_active,
      created_at: f.created_at,
    }));
  } else if (type === 'risk_cases') {
    const riskResult = await listRiskCases({ page: 1, limit: 100 }, 'super_admin');
    rows = riskResult.items;
  } else if (type === 'doctors') {
    const doctorsResult = await listDoctors({ status: 'all' });
    rows = doctorsResult.items;
  } else if (type === 'facilities') {
    const facilities = await db.collection('facility_locations').find({}).toArray();
    rows = facilities.map((f) => ({
      id: f.id,
      name: f.name,
      area: f.area,
      facility_type: f.facility_type,
      verification_status: f.verification_status,
      is_active: f.is_active,
      created_at: f.created_at,
    }));
  } else if (type === 'patient_follow_up') {
    const riskResult = await listRiskCases({ page: 1, limit: 100, follow_up_status: 'needs_follow_up' }, 'super_admin');
    rows = riskResult.items;
  } else {
    rows = (await dateRows('emergency_requests')).map((item) => ({
      ...item,
      patient_code: patientMap.get(item.patient_id)?.patient_code,
    }));
  }
  rows = rows.slice(0, 5000).map((item) => {
    const result = { ...item };
    delete result._id;
    return result;
  });
  await writeAudit(db, req, {
    action: 'admin.report.export',
    entity: 'reports',
    entityId: type,
    metadata: { type, format, from: from || null, to: to || null, rows: rows.length },
  });
  if (format === 'csv')
    return { format, content: csvReport(rows, type), filename: `${type}-report.csv` };
  if (format === 'pdf') {
    const headers = reportColumns[type];
    const lines = rows.map((row) => headers.map((header) => row[header] ?? '').join(' | '));
    const safetyNotices =
      type === 'screenings'
        ? [
            ...new Set(
              rows.flatMap((row) => [row.output_banner, row.medical_limitations]).filter(Boolean),
            ),
          ]
        : [];
    return {
      format,
      content: makePdf(
        [`${type.toUpperCase()} REPORT`, ...safetyNotices, headers.join(' | '), ...lines].join(
          '\n',
        ),
      ),
      filename: `${type}-report.pdf`,
    };
  }
  return { format, content: rows, filename: `${type}-report.json` };
}

async function listAuditLogs(filters, pagination, actorRole) {
  const db = await getDb();
  const [logs, users] = await Promise.all([
    db.collection('audit_logs').find({}).toArray(),
    db.collection('users').find({}).toArray(),
  ]);
  const userMap = new Map(users.map((user) => [user.id, user]));
  const selected = logs
    .filter((log) => {
      if (filters.user && log.user_id !== filters.user) return false;
      if (
        filters.action &&
        !String(log.action || '')
          .toLowerCase()
          .includes(filters.action.toLowerCase())
      )
        return false;
      if (filters.resource && log.entity !== filters.resource) return false;
      if (filters.from && dateValue(log.created_at) < new Date(`${filters.from}T00:00:00.000Z`))
        return false;
      if (
        filters.to &&
        dateValue(log.created_at) >=
          new Date(new Date(`${filters.to}T00:00:00.000Z`).getTime() + 86400000)
      )
        return false;
      if (actorRole !== 'super_admin') {
        const actor = userMap.get(log.user_id);
        const target = users.find((user) => user.id === log.entity_id);
        if (actor?.role === 'super_admin' || target?.role === 'super_admin') return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        dateValue(b.created_at) - dateValue(a.created_at) ||
        String(b.id).localeCompare(String(a.id)),
    );
  const total = selected.length;
  const items = selected
    .slice(pagination.offset, pagination.offset + pagination.limit)
    .map((log) => {
      const user = userMap.get(log.user_id);
      const entry = { ...log };
      delete entry._id;
      return { ...entry, user_name: user?.full_name || null, user_role: user?.role || null };
    });
  return {
    items,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
    },
  };
}

module.exports = {
  dashboard,
  listRiskCases,
  assignScreeningDoctor,
  updateScreeningFollowUp,
  screeningAnalytics,
  appointmentManagement,
  updateAppointmentStatus,
  listHospitals,
  updateFacilityStatus,
  assignFacilityManager,
  listManagers,
  listDoctors,
  listPatients,
  listRegistrations,
  listActivities,
  listFacilityDirectory,
  createFacilityDirectoryEntry,
  updateFacilityDirectoryEntry,
  listRoles,
  updateRolePermissions,
  createUser,
  listUsers,
  getUser,
  updateUser,
  reviewDoctorRegistration,
  reviewAdminRegistration,
  deleteUser,
  report,
  listAuditLogs,
};
