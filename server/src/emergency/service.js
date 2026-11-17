const { randomUUID } = require('node:crypto');
const { getDb } = require('../db/mongo');
const smsAdapter = require('./smsAdapter');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function pageArgs(query) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw httpError(400, 'INVALID_PAGINATION', 'page must be positive and limit must be between 1 and 100');
  }
  return { page, limit, offset: (page - 1) * limit };
}

async function audit(db, req, action, entity, entityId, metadata = {}) {
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: req.user.sub,
    action,
    entity,
    entity_id: entityId,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || '',
    metadata,
    created_at: new Date(),
  });
}

async function findPatient(db, patientId, user, requireWorkerAssignment = true) {
  let patient;
  if (user.role === 'patient') {
    patient = await db.collection('patients').findOne({ user_id: user.sub, is_active: true });
    if (patientId && patient?.id !== patientId) {
      throw httpError(403, 'FORBIDDEN', 'You can only access your own emergency records');
    }
  } else {
    patient = await db.collection('patients').findOne({ id: patientId, is_active: true });
    if (patient && user.role === 'health_worker' && requireWorkerAssignment) {
      const assignment = await db.collection('health_workers').findOne({
        user_id: user.sub,
        $or: [
          ...(patient.phc_id ? [{ phc_id: patient.phc_id }] : []),
          ...(patient.village_id ? [{ village_id: patient.village_id }] : []),
        ],
      });
      if (!assignment) throw httpError(403, 'OUTSIDE_ASSIGNED_AREA', 'Patient is outside your assigned area');
    }
    if (patient && user.role === 'doctor') {
      const doctor = await db.collection('doctors').findOne({ user_id: user.sub });
      const appointment = doctor && await db.collection('appointments').findOne({
        doctor_id: doctor.id,
        patient_id: patient.id,
      });
      if (!doctor || !(doctor.phc_id && doctor.phc_id === patient.phc_id) && !appointment) {
        throw httpError(403, 'PATIENT_NOT_ASSIGNED', 'Patient is not assigned to this doctor');
      }
    }
    if (patient && user.role === 'specialist') {
      const specialist = await db.collection('specialists').findOne({ user_id: user.sub });
      const referral = specialist && await db.collection('referrals').findOne({
        referred_to_specialist_id: specialist.id,
        patient_id: patient.id,
        status: { $ne: 'rejected' },
      });
      if (!referral) throw httpError(403, 'PATIENT_NOT_REFERRED', 'Patient is not referred to this specialist');
    }
  }
  if (!patient) throw httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found');
  return patient;
}

const sosCopy = {
  en: { title: 'Emergency SOS', body: 'A patient requested emergency help. Please contact them now.', noDispatch: 'This app does not dispatch an ambulance.' },
  te: { title: 'అత్యవసర SOS', body: 'ఒక రోగి అత్యవసర సహాయం కోరారు. దయచేసి వెంటనే సంప్రదించండి.', noDispatch: 'ఈ యాప్ అంబులెన్స్‌ను పంపదు.' },
  hi: { title: 'आपातकालीन SOS', body: 'एक मरीज ने आपातकालीन सहायता मांगी है। कृपया अभी संपर्क करें।', noDispatch: 'यह ऐप एम्बुलेंस नहीं भेजता।' },
  or: { title: 'ଜରୁରୀ SOS', body: 'ଜଣେ ରୋଗୀ ଜରୁରୀ ସହାୟତା ମାଗିଛନ୍ତି। ଦୟାକରି ତୁରନ୍ତ ଯୋଗାଯୋଗ କରନ୍ତୁ।', noDispatch: 'ଏହି ଆପ୍ ଆମ୍ବୁଲାନ୍ସ ପଠାଏ ନାହିଁ।' },
};

async function notifyUser(db, userId, title, body, data) {
  if (!userId) return;
  const user = await db.collection('users').findOne({ id: userId, is_active: true, deleted_at: null });
  if (!user) return;
  await notificationService.create(db, userId, 'emergency', data, {
    type: 'emergency',
    title,
    body,
  });
}

async function sendSos(body, user, req) {
  if (user.role === 'health_worker' && !body.patient_id) {
    throw httpError(400, 'PATIENT_REQUIRED', 'patient_id is required when a health worker submits an SOS');
  }
  const db = await getDb();
  const patient = await findPatient(db, body.patient_id, user);
  const contacts = body.contact_ids.length
    ? await db.collection('emergency_contacts').find({
      patient_id: patient.id,
      id: { $in: body.contact_ids },
    }).toArray()
    : [];
  if (contacts.length !== body.contact_ids.length) {
    throw httpError(422, 'INVALID_EMERGENCY_CONTACT', 'One or more selected contacts do not belong to this patient');
  }
  const shareLocation = body.location_consent === true
    && body.latitude !== undefined
    && body.longitude !== undefined;
  const now = new Date();
  const request = {
    id: randomUUID(),
    patient_id: patient.id,
    lat: shareLocation ? body.latitude : null,
    lng: shareLocation ? body.longitude : null,
    location_consent: shareLocation,
    notified_contacts: contacts.map((contact) => contact.id),
    notes: body.notes,
    status: 'open',
    created_at: now,
    updated_at: now,
  };
  await db.collection('emergency_requests').insertOne(request);
  const localized = sosCopy[patient.preferred_language] || sosCopy.en;
  const notificationData = { request_id: request.id, patient_id: patient.id, location_shared: shareLocation };
  const adminUsers = await db.collection('users').find({
    is_active: true,
    deleted_at: null,
    role: { $in: ['admin', 'super_admin'] },
  }).toArray();
  for (const target of adminUsers) await notifyUser(db, target.id, localized.title, localized.body, notificationData);
  if (patient.phc_id) {
    const workers = await db.collection('health_workers').find({ phc_id: patient.phc_id }).toArray();
    const doctors = await db.collection('doctors').find({ phc_id: patient.phc_id }).toArray();
    const staffIds = new Set([...workers, ...doctors].map((item) => item.user_id));
    for (const staffId of staffIds) await notifyUser(db, staffId, localized.title, localized.body, notificationData);
  }
  await audit(db, req, 'emergency.sos_created', 'emergency_request', request.id, {
    patient_id: patient.id,
    location_shared: shareLocation,
    contacts_notified: contacts.length,
  });

  const mapUrl = shareLocation
    ? `https://maps.google.com/?q=${encodeURIComponent(`${request.lat},${request.lng}`)}`
    : null;
  const smsOutcomes = [];
  const contactCopy = sosCopy[patient.preferred_language] || sosCopy.en;
  const deliveredContactIds = [];
  for (const contact of contacts) {
    const message = shareLocation
      ? `${contactCopy.body} Location: ${mapUrl}. ${contactCopy.noDispatch}`
      : `${contactCopy.body} ${contactCopy.noDispatch}`;
    try {
      const delivery = await smsAdapter.sendSms({
        to: contact.mobile,
        message,
        idempotencyKey: `aarogya-sos-${request.id}-${contact.id}`,
      });
      if (delivery.delivered) deliveredContactIds.push(contact.id);
      smsOutcomes.push({ contact_id: contact.id, ...delivery });
    } catch (error) {
      logger.error('Emergency contact SMS delivery failed', {
        requestId: request.id,
        contactId: contact.id,
        errorMessage: error.message,
      });
      smsOutcomes.push({ contact_id: contact.id, delivered: false, reason: 'provider_error' });
    }
  }
  await db.collection('emergency_requests').updateOne({ id: request.id }, {
    $set: { notified_contacts: deliveredContactIds, updated_at: new Date() },
  });
  request.notified_contacts = deliveredContactIds;
  await audit(db, req, 'emergency.sos_delivery', 'emergency_request', request.id, {
    attempted: contacts.length,
    delivered: deliveredContactIds.length,
  });
  const facilities = await nearbyHospitals({
    ...(shareLocation
      ? { latitude: request.lat, longitude: request.lng, radius_km: 500 }
      : { district: patient.district }),
    ...(user.role === 'health_worker' ? { patient_id: patient.id } : {}),
  }, user);
  const hospitals = facilities.data.hospitals;
  const requestResponse = {
    id: request.id,
    patient_id: request.patient_id,
    location_consent: request.location_consent,
    status: request.status,
    created_at: request.created_at,
    location_shared: shareLocation,
  };
  return {
    data: {
      request: requestResponse,
      callable_options: {
        emergency: { label: 'Call 108', href: 'tel:108' },
        hospitals: hospitals.map((hospital) => ({
          name: hospital.name,
          phone: hospital.emergency_phone || hospital.phone,
          emergency_phone: hospital.emergency_phone,
          ambulance_info: hospital.ambulance_info,
          address: hospital.address,
          directions_url: hospital.directions_url,
        })),
        ambulance_info: hospitals.find((hospital) => hospital.ambulance_info)?.ambulance_info || '',
        note: 'This app does not dispatch an ambulance. Call 108 now.',
      },
      contacts_delivery: smsOutcomes,
    },
  };
}

async function getContacts(query, user) {
  if (user.role !== 'patient' && !query.patient_id) {
    throw httpError(400, 'PATIENT_REQUIRED', 'patient_id is required for staff contact lookup');
  }
  const db = await getDb();
  const { page, limit, offset } = pageArgs(query);
  const patient = await findPatient(db, query.patient_id, user);
  const contacts = await db.collection('emergency_contacts').find({ patient_id: patient.id })
    .sort({ is_primary: -1, created_at: 1 }).toArray();
  let requests;
  let requestMeta;
  if (query.include === 'requests') {
    const requestList = await db.collection('emergency_requests').find({ patient_id: patient.id })
      .sort({ created_at: -1 }).toArray();
    requests = requestList.slice(offset, offset + limit).map((item) => ({
      id: item.id,
      status: item.status,
      created_at: item.created_at,
      location_shared: item.location_consent,
      notified_contact_ids: item.notified_contacts,
      notes: item.notes,
    }));
    requestMeta = {
      page,
      limit,
      total: requestList.length,
      totalPages: Math.ceil(requestList.length / limit),
    };
  }
  const items = contacts.slice(offset, offset + limit).map((item) => ({
    id: item.id,
    patient_id: item.patient_id,
    name: item.full_name,
    relationship: item.relationship,
    mobile: item.mobile,
    is_primary: item.is_primary,
    created_at: item.created_at,
  }));
  return {
    data: { contacts: items, ...(requests ? { requests, request_meta: requestMeta } : {}) },
    meta: { page, limit, total: contacts.length, totalPages: Math.ceil(contacts.length / limit) },
  };
}

async function addContact(body, user, req) {
  if (user.role === 'health_worker' && !body.patient_id) {
    throw httpError(400, 'PATIENT_REQUIRED', 'patient_id is required when a health worker adds a contact');
  }
  if (body.action === 'update' && user.role === 'health_worker' && !body.patient_id) {
    throw httpError(400, 'PATIENT_REQUIRED', 'patient_id is required when a health worker edits a contact');
  }
  const db = await getDb();
  if (body.action === 'update') {
    const patient = await findPatient(db, body.patient_id, user);
    const existing = await db.collection('emergency_contacts').findOne({
      id: body.contact_id,
      patient_id: patient.id,
    });
    if (!existing) throw httpError(404, 'CONTACT_NOT_FOUND', 'Emergency contact not found');
    if (body.is_primary === true) {
      await db.collection('emergency_contacts').updateMany({ patient_id: patient.id }, { $set: { is_primary: false } });
    }
    const update = {};
    if (body.name) update.full_name = body.name;
    if (body.relationship) update.relationship = body.relationship;
    if (body.mobile) update.mobile = body.mobile.replace(/[\s-]/g, '');
    if (body.is_primary !== undefined) update.is_primary = body.is_primary;
    update.updated_at = new Date();
    const result = await db.collection('emergency_contacts').findOneAndUpdate(
      { id: body.contact_id, patient_id: patient.id },
      { $set: update },
      { returnDocument: 'after' },
    );
    await audit(db, req, 'emergency_contact.updated', 'emergency_contact', result.id, { patient_id: patient.id });
    return {
      data: {
        contact: {
          id: result.id,
          patient_id: result.patient_id,
          name: result.full_name,
          relationship: result.relationship,
          mobile: result.mobile,
          is_primary: result.is_primary,
          created_at: result.created_at,
          updated_at: result.updated_at,
        },
      },
    };
  }
  const patient = await findPatient(db, body.patient_id, user);
  const count = await db.collection('emergency_contacts').countDocuments({ patient_id: patient.id });
  if (count >= 5) throw httpError(409, 'CONTACT_LIMIT_REACHED', 'A patient can have up to five emergency contacts');
  if (body.is_primary) {
    await db.collection('emergency_contacts').updateMany({ patient_id: patient.id }, { $set: { is_primary: false } });
  }
  const contact = {
    id: randomUUID(),
    patient_id: patient.id,
    full_name: body.name,
    relationship: body.relationship,
    mobile: body.mobile.replace(/[\s-]/g, ''),
    is_primary: body.is_primary,
    created_at: new Date(),
    updated_at: new Date(),
  };
  await db.collection('emergency_contacts').insertOne(contact);
  await audit(db, req, 'emergency_contact.created', 'emergency_contact', contact.id, { patient_id: patient.id });
  return {
    data: {
      contact: {
        id: contact.id,
        patient_id: contact.patient_id,
        name: contact.full_name,
        relationship: contact.relationship,
        mobile: contact.mobile,
        is_primary: contact.is_primary,
        created_at: contact.created_at,
      },
    },
  };
}

function haversineDistance(latitude, longitude, targetLatitude, targetLongitude) {
  const radians = (value) => (value * Math.PI) / 180;
  const latDiff = radians(targetLatitude - latitude);
  const lngDiff = radians(targetLongitude - longitude);
  const value = Math.sin(latDiff / 2) ** 2 +
    Math.cos(radians(latitude)) * Math.cos(radians(targetLatitude)) * Math.sin(lngDiff / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

async function nearbyHospitals(query, user) {
  const db = await getDb();
  const { page, limit, offset } = pageArgs(query);
  let latitude = query.latitude ?? query.lat;
  let longitude = query.longitude ?? query.lng;
  let district = query.district;
  if (user.role === 'patient' || query.patient_id) {
    const patient = await findPatient(db, query.patient_id, user);
    district = district || patient.district;
  }
  const facilities = [];
  for (const facilityType of ['hospital', 'phc']) {
    const rows = await db.collection(facilityType === 'hospital' ? 'hospitals' : 'phcs')
      .find({ is_active: true }).toArray();
    for (const facility of rows) {
      let distance = null;
      if (latitude !== undefined) {
        if (facility.latitude === undefined || facility.longitude === undefined) continue;
        distance = haversineDistance(Number(latitude), Number(longitude), Number(facility.latitude), Number(facility.longitude));
        if (distance > Number(query.radius_km)) continue;
      } else if (district && !String(facility.district || '').toLowerCase().includes(String(district).toLowerCase())) {
        continue;
      }
      facilities.push({
        id: facility.id,
        name: facility.name,
        facility_type: facilityType,
        district: facility.district,
        address: facility.address,
        phone: facility.mobile,
        emergency_phone: facility.emergency_phone,
        ambulance_info: facility.ambulance_info,
        latitude: facility.latitude ?? null,
        longitude: facility.longitude ?? null,
        distance_km: distance,
      });
    }
  }
  facilities.sort((left, right) => (left.distance_km ?? Infinity) - (right.distance_km ?? Infinity) ||
    left.name.localeCompare(right.name));
  const hospitals = facilities.slice(offset, offset + limit).map((facility) => ({
    ...facility,
    directions_url: facility.latitude !== null && facility.longitude !== null
      ? `https://www.google.com/maps/dir/?api=1&destination=${facility.latitude},${facility.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${facility.name} ${facility.district}`)}`,
  }));
  return {
    data: {
      hospitals,
      search: latitude === undefined ? { district: district || null } : { latitude, longitude, radius_km: query.radius_km },
    },
    meta: { total: facilities.length, page, limit, totalPages: Math.ceil(facilities.length / limit) },
  };
}

module.exports = { sendSos, getContacts, addContact, nearbyHospitals, httpError };
