const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const { getDb } = require('../db/mongo');
const storage = require('../adapters/privateImageStorage');
const { extractAndRedact } = require('./aadhaarOcrService');

const STAGING_LIFETIME_MS = 60 * 60 * 1000;

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function removeStagedFiles(staged) {
  await Promise.all((staged?.files || []).map((file) => storage.deleteObject(file.storage_key).catch(() => {})));
}

async function cleanupExpired(db, now = new Date()) {
  const uploads = db.collection('aadhaar_uploads');
  const expired = await uploads.find({ expires_at: { $lte: now } }).toArray();
  for (const upload of expired) {
    await removeStagedFiles(upload);
    await uploads.deleteOne({ id: upload.id });
  }
}

async function cleanupExpiredStagedUploads() {
  const db = await getDb();
  return cleanupExpired(db);
}

async function extractAndStage(file, input, req) {
  if (!file?.buffer) throw httpError(400, 'AADHAAR_FILE_REQUIRED', 'Select a document first.');
  if (input.consent !== 'true') {
    throw httpError(422, 'AADHAAR_CONSENT_REQUIRED', 'Explicit Aadhaar document processing consent is required.');
  }
  if (!['front', 'back'].includes(input.side)) {
    throw httpError(422, 'AADHAAR_SIDE_REQUIRED', 'Choose whether this is the front or back side.');
  }
  const language = ['en', 'te', 'hi', 'or'].includes(input.language) ? input.language : 'en';
  const db = await getDb();
  await cleanupExpired(db);
  let ocr;
  try {
    ocr = await extractAndRedact(file.buffer, file.mimetype);
  } finally {
    file.buffer.fill(0);
  }

  const result = {
    fields: {
      full_name: ocr.fields.full_name,
      date_of_birth: ocr.fields.date_of_birth,
      gender: ocr.fields.gender,
      address: ocr.fields.address,
      aadhaar_number: ocr.fields.aadhaar_number,
      aadhaar_last4: ocr.fields.aadhaar_last4,
    },
    stage_id: null,
    document_stored: false,
    warning_code: ocr.warning_code,
    redacted_preview: null,
  };
  if (!ocr.documents_ready) return result;

  const files = [];
  let redactedPreview;
  try {
    for (let index = 0; index < ocr.redacted_pages.length; index += 1) {
      if (index === 0) {
        redactedPreview = await sharp(ocr.redacted_pages[index]).jpeg({ quality: 65 }).toBuffer();
      }
      const metadata = await storage.encryptAndStore(ocr.redacted_pages[index]);
      files.push({
        ...metadata,
        mime_type: 'image/png',
        page: index + 1,
      });
      ocr.redacted_pages[index].fill(0);
    }
    const stage = {
      id: randomUUID(),
      uploaded_by: req.user.sub,
      side: input.side,
      aadhaar_last4: ocr.fields.aadhaar_last4,
      files,
      consent_granted: true,
      consent_language: language,
      consented_at: new Date(),
      expires_at: new Date(Date.now() + STAGING_LIFETIME_MS),
      created_at: new Date(),
    };
    await db.collection('aadhaar_uploads').insertOne(stage);
    result.stage_id = stage.id;
    result.document_stored = true;
    result.warning_code = null;
    result.redacted_preview = `data:image/jpeg;base64,${redactedPreview.toString('base64')}`;
    redactedPreview.fill(0);
  } catch (error) {
    await removeStagedFiles({ files });
    redactedPreview?.fill(0);
    throw error;
  }
  return result;
}

async function deleteStaged(uploadId, req) {
  const db = await getDb();
  const upload = await db.collection('aadhaar_uploads').findOne({ id: uploadId });
  if (!upload) return;
  if (upload.uploaded_by !== req.user.sub) throw httpError(403, 'FORBIDDEN', 'This upload belongs to another user.');
  await removeStagedFiles(upload);
  await db.collection('aadhaar_uploads').deleteOne({ id: uploadId, uploaded_by: req.user.sub });
}

async function validateStagedUploads(db, input, req) {
  const ids = input.aadhaar_upload_ids || [];
  if (!ids.length && !input.aadhaar_last4) return [];
  if (!input.aadhaar_consent?.given) {
    throw httpError(422, 'AADHAAR_CONSENT_REQUIRED', 'Explicit Aadhaar consent is required.');
  }
  await cleanupExpired(db);
  const uploads = ids.length
    ? await db.collection('aadhaar_uploads').find({
      id: { $in: ids }, uploaded_by: req.user.sub, expires_at: { $gt: new Date() },
    }).toArray()
    : [];
  if (uploads.length !== ids.length) {
    throw httpError(409, 'AADHAAR_UPLOAD_EXPIRED', 'An Aadhaar upload expired. Upload the document again.');
  }
  if (new Set(uploads.map((upload) => upload.side)).size !== uploads.length) {
    throw httpError(422, 'AADHAAR_SIDE_DUPLICATE', 'Only one front-side and one back-side document can be attached.');
  }
  const last4Values = [...new Set(uploads.map((upload) => upload.aadhaar_last4))];
  if (last4Values.length > 1 || (input.aadhaar_last4 && last4Values.length && input.aadhaar_last4 !== last4Values[0])) {
    throw httpError(422, 'AADHAAR_NUMBER_MISMATCH', 'The number entered does not match the uploaded document. Remove or replace that document.');
  }
  return uploads;
}

async function attachStaged(db, patient, input, req) {
  const ids = input.aadhaar_upload_ids || [];
  if (!ids.length && !input.aadhaar_last4) return [];
  const now = new Date();
  if (ids.length) await cleanupExpired(db);
  const uploadsExist = ids.length
    ? await db.collection('aadhaar_uploads').countDocuments({ id: { $in: ids }, uploaded_by: req.user.sub })
    : 0;
  if (ids.length && uploadsExist !== ids.length) {
    const alreadyAttached = await db.collection('aadhaar_documents').find({
      patient_id: patient.id,
      source_upload_id: { $in: ids },
    }).toArray();
    if (ids.every((id) => alreadyAttached.some((document) => document.source_upload_id === id))) {
      return alreadyAttached.map((document) => document.id);
    }
  }
  const uploads = await validateStagedUploads(db, input, req);
  const documentRows = uploads.flatMap((upload) => upload.files.map((file) => ({
    id: randomUUID(),
    patient_id: patient.id,
    source_upload_id: upload.id,
    side: upload.side,
    page: file.page,
    mime_type: file.mime_type,
    redacted: true,
    storage_key: file.storage_key,
    encryption_algorithm: file.encryption_algorithm,
    encryption_key_id: file.encryption_key_id,
    encryption_iv: file.encryption_iv,
    encryption_auth_tag: file.encryption_auth_tag,
    content_hash: file.content_hash,
    uploaded_by: req.user.sub,
    consent_language: input.aadhaar_consent.language,
    consented_at: upload.consented_at,
    created_at: now,
  })));
  if (documentRows.length) await db.collection('aadhaar_documents').insertMany(documentRows);
  await db.collection('patients').updateOne({ id: patient.id }, {
    $set: {
      aadhaar_last4: input.aadhaar_last4 || last4Values[0] || null,
      aadhaar_verification_status: 'details_confirmed_unverified',
      aadhaar_document_ids: documentRows.map((document) => document.id),
      updated_at: now,
    },
  });
  await db.collection('patient_consents').updateOne(
    { patient_id: patient.id, consent_type: 'aadhaar_documents' },
    {
      $set: {
        granted: true,
        version: 1,
        language: input.aadhaar_consent.language,
        granted_at: now,
        revoked_at: null,
        recorded_by: req.user.sub,
        updated_at: now,
      },
      $setOnInsert: { id: randomUUID(), patient_id: patient.id, consent_type: 'aadhaar_documents', created_at: now },
    },
    { upsert: true },
  );
  await Promise.all(uploads.map((upload) => db.collection('aadhaar_uploads').deleteOne({ id: upload.id })));
  return documentRows.map((document) => document.id);
}

async function getDocument(patientId, documentId, user, req) {
  const patientService = require('./service');
  await patientService.assertPatientScope(patientId, user);
  const db = await getDb();
  const [consent, document] = await Promise.all([
    db.collection('patient_consents').findOne({ patient_id: patientId, consent_type: 'aadhaar_documents', granted: true }),
    db.collection('aadhaar_documents').findOne({ id: documentId, patient_id: patientId, redacted: true }),
  ]);
  if (!consent || !document) throw httpError(404, 'AADHAAR_DOCUMENT_NOT_FOUND', 'The Aadhaar document is unavailable.');
  await db.collection('audit_logs').insertOne({
    id: randomUUID(), user_id: req.user.sub, action: 'patient.aadhaar_document.accessed',
    entity: 'patient', entity_id: patientId, ip: req.ip || null, user_agent: req.get('user-agent') || '',
    metadata: { document_id: documentId, side: document.side, actor_role: user.role }, created_at: new Date(),
  });
  const content = await storage.decryptStoredImage(document);
  return { content, side: document.side, page: document.page };
}

async function revokePatientDocuments(db, patientId) {
  const documents = await db.collection('aadhaar_documents').find({ patient_id: patientId }).toArray();
  await Promise.all(documents.map((document) => storage.deleteObject(document.storage_key).catch(() => {})));
  await db.collection('aadhaar_documents').deleteMany({ patient_id: patientId });
  await db.collection('patients').updateOne({ id: patientId }, {
    $set: { aadhaar_last4: null, aadhaar_verification_status: 'consent_revoked', aadhaar_document_ids: [], updated_at: new Date() },
  });
}

module.exports = { extractAndStage, deleteStaged, validateStagedUploads, attachStaged, getDocument, cleanupExpired, cleanupExpiredStagedUploads, revokePatientDocuments };
