'use strict';

const { createHmac, randomUUID } = require('node:crypto');
const { getDb } = require('../db/mongo');
const { createManifest, hashManifest } = require('./manifest');

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
function subjectKey(patientId) {
  const secret = process.env.RESEARCH_SUBJECT_HMAC_KEY;
  if (!secret || secret.length < 32)
    throw fail(
      503,
      'RESEARCH_KEY_NOT_CONFIGURED',
      'Research de-identification key is not configured',
    );
  return createHmac('sha256', secret).update(patientId).digest('hex');
}
async function audit(db, user, action, datasetId, metadata = {}) {
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: user.sub,
    action,
    entity: 'research_dataset',
    entity_id: datasetId,
    metadata,
    created_at: new Date(),
  });
}

function governanceConfiguration() {
  const approvalReference = process.env.RESEARCH_ETHICS_APPROVAL_REFERENCE?.trim() || '';
  const governanceBody = process.env.RESEARCH_GOVERNANCE_BODY?.trim() || '';
  const contact = process.env.RESEARCH_GOVERNANCE_CONTACT?.trim() || '';
  const retentionPolicy = process.env.RESEARCH_RETENTION_POLICY?.trim() || '';
  const enabled =
    process.env.RESEARCH_GOVERNANCE_ENABLED === 'true' &&
    Boolean(approvalReference && governanceBody && contact && retentionPolicy) &&
    Boolean(
      process.env.RESEARCH_SUBJECT_HMAC_KEY &&
      process.env.RESEARCH_SUBJECT_HMAC_KEY.length >= 32,
    );
  return {
    enabled,
    consent_version: process.env.RESEARCH_CONSENT_VERSION?.trim() || '1.0',
    approval_reference: approvalReference || null,
    governance_body: governanceBody || null,
    contact: contact || null,
    retention_policy: retentionPolicy || null,
  };
}

function requireGovernance() {
  if (!governanceConfiguration().enabled)
    throw fail(
      503,
      'RESEARCH_GOVERNANCE_UNAVAILABLE',
      'Research participation is unavailable until institutional governance, contact, and retention details are configured',
    );
}

async function participantForUser(db, user) {
  if (user.role !== 'patient')
    throw fail(403, 'PATIENT_ACCOUNT_REQUIRED', 'A patient account is required');
  const patient = await db.collection('patients').findOne({
    user_id: user.sub,
    is_active: { $ne: false },
    deleted_at: null,
  });
  if (!patient) throw fail(404, 'PATIENT_RECORD_NOT_FOUND', 'Patient record not found');
  return patient;
}

async function latestResearchConsent(db, patientId) {
  const records = await db
    .collection('research_consents')
    .find({ patient_id: patientId })
    .sort({ sequence: -1, created_at: -1, id: -1 })
    .limit(1)
    .toArray();
  return records[0] || null;
}

function nextConsentTimestamp(current) {
  const last = current?.created_at instanceof Date ? current.created_at.getTime() : 0;
  return new Date(Math.max(Date.now(), last + 1));
}

async function activeConsentForItem(db, item) {
  if (item.research_use_blocked || !item.patient_id) return null;
  const consent = await db.collection('research_consents').findOne({
    id: item.consent_record_id,
    patient_id: item.patient_id,
    status: 'granted',
    purpose: 'research_ai_training',
  });
  if (!consent) return null;
  const latest = await latestResearchConsent(db, consent.patient_id);
  return latest?.id === consent.id && latest.status === 'granted' ? consent : null;
}

async function getResearchConsent(user) {
  const db = await getDb();
  const patient = await participantForUser(db, user);
  const records = await db
    .collection('research_consents')
    .find({ patient_id: patient.id })
    .sort({ sequence: -1, created_at: -1, id: -1 })
    .limit(50)
    .toArray();
  const latest = records[0] || null;
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: user.sub,
    action: 'research.consent_history_accessed',
    entity: 'research_consent',
    entity_id: latest?.id || patient.id,
    metadata: { count: records.length },
    created_at: new Date(),
  });
  return {
    governance: governanceConfiguration(),
    consent: latest,
    history: records,
  };
}

async function grantResearchConsent(input, user) {
  requireGovernance();
  const db = await getDb();
  const patient = await participantForUser(db, user);
  const current = await latestResearchConsent(db, patient.id);
  if (current?.status === 'granted')
    throw fail(409, 'RESEARCH_CONSENT_ALREADY_ACTIVE', 'Research consent is already active');
  const now = nextConsentTimestamp(current);
  const consent = {
    id: randomUUID(),
    patient_id: patient.id,
    user_id: user.sub,
    sequence: (current?.sequence || 0) + 1,
    purpose: 'research_ai_training',
    research_ai_training: true,
    consent_version: governanceConfiguration().consent_version,
    language: input.language,
    status: 'granted',
    granted_at: now,
    withdrawn_at: null,
    previous_record_id: current?.id || null,
    created_at: now,
  };
  try {
    await db.collection('research_consents').insertOne(consent);
  } catch (error) {
    if (error.code === 11000)
      throw fail(409, 'RESEARCH_CONSENT_CHANGED', 'Research consent changed; reload its current status');
    throw error;
  }
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: user.sub,
    action: 'research.consent_granted',
    entity: 'research_consent',
    entity_id: consent.id,
    metadata: {
      consent_version: consent.consent_version,
      purpose: consent.purpose,
      language: consent.language,
    },
    created_at: now,
  });
  return consent;
}

async function withdrawResearchConsent(user) {
  const db = await getDb();
  const patient = await participantForUser(db, user);
  const current = await latestResearchConsent(db, patient.id);
  if (!current || current.status !== 'granted')
    throw fail(409, 'NO_ACTIVE_RESEARCH_CONSENT', 'There is no active research consent to withdraw');
  const now = nextConsentTimestamp(current);
  const withdrawal = {
    id: randomUUID(),
    patient_id: patient.id,
    user_id: user.sub,
    sequence: (current.sequence || 0) + 1,
    purpose: current.purpose,
    research_ai_training: false,
    consent_version: current.consent_version,
    language: current.language,
    status: 'withdrawn',
    granted_at: current.granted_at,
    withdrawn_at: now,
    previous_record_id: current.id,
    created_at: now,
  };
  try {
    await db.collection('research_consents').insertOne(withdrawal);
  } catch (error) {
    if (error.code === 11000)
      throw fail(409, 'RESEARCH_CONSENT_CHANGED', 'Research consent changed; reload its current status');
    throw error;
  }
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: user.sub,
    action: 'research.consent_withdrawn',
    entity: 'research_consent',
    entity_id: withdrawal.id,
    metadata: {
      consent_version: current.consent_version,
      purpose: current.purpose,
    },
    created_at: now,
  });
  const result = await db.collection('research_dataset_items').updateMany(
    { consent_record_id: current.id, research_use_blocked: { $ne: true } },
    { $set: { research_use_blocked: true, research_use_blocked_at: now, updated_at: now } },
  );
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: user.sub,
    action: 'research.consent_withdrawal_items_blocked',
    entity: 'research_consent',
    entity_id: withdrawal.id,
    metadata: { blocked_dataset_items: result.modifiedCount || 0 },
    created_at: now,
  });
  return withdrawal;
}

async function createDataset(input, user) {
  requireGovernance();
  const db = await getDb();
  const now = new Date();
  const dataset = {
    id: randomUUID(),
    name: input.name,
    version: input.version,
    description: input.description,
    status: 'open',
    created_by: user.sub,
    created_at: now,
    updated_at: now,
  };
  try {
    await db.collection('research_datasets').insertOne(dataset);
  } catch (error) {
    if (error.code === 11000)
      throw fail(409, 'DATASET_VERSION_EXISTS', 'Dataset name and version already exist');
    throw error;
  }
  await audit(db, user, 'research.dataset_created', dataset.id, { version: dataset.version });
  return dataset;
}

async function listDatasets(user) {
  requireGovernance();
  const db = await getDb();
  const datasets = await db
    .collection('research_datasets')
    .find({}, { projection: { created_by: 0 } })
    .sort({ created_at: -1 })
    .toArray();
  await audit(db, user, 'research.datasets_accessed', null, { count: datasets.length });
  return datasets;
}

async function listItems(datasetId) {
  requireGovernance();
  const db = await getDb();
  const dataset = await db.collection('research_datasets').findOne({ id: datasetId });
  if (!dataset) throw fail(404, 'DATASET_NOT_FOUND', 'Research dataset not found');
  const storedItems = await db
    .collection('research_dataset_items')
    .find({ dataset_id: datasetId })
    .sort({ created_at: 1 })
    .toArray();
  const annotations = new Map();
  for (const item of storedItems) {
    if (!item.annotation_id) continue;
    const annotation = await db.collection('research_annotations').findOne({
      id: item.annotation_id,
      item_id: item.id,
    });
    if (annotation) annotations.set(item.id, annotation);
  }
  if (dataset.status === 'sealed') {
    const sealedManifest = createManifest(dataset, storedItems, annotations);
    if (
      dataset.manifest_algorithm !== 'sha256' ||
      dataset.manifest_version !== 1 ||
      dataset.manifest_item_count !== sealedManifest.items.length ||
      dataset.manifest_hash !== hashManifest(sealedManifest)
    ) {
      await audit(db, { sub: 'system' }, 'research.dataset_manifest_integrity_failed', datasetId, {
        version: dataset.version,
      });
      throw fail(409, 'DATASET_MANIFEST_INVALID', 'Sealed dataset manifest failed integrity verification');
    }
  }
  const items = [];
  const activeItems = [];
  for (const item of storedItems) {
    if (!(await activeConsentForItem(db, item))) continue;
    activeItems.push(item);
    const annotation = annotations.get(item.id);
    items.push({
      id: item.id,
      dataset_version: item.dataset_version,
      image_id: item.image_id,
      encrypted_object_id: item.encrypted_object_id,
      subject_key: item.subject_key,
      split: item.split,
      annotation_status: item.annotation_status,
      annotation: annotation
        ? {
            labels: annotation.labels,
            anatomical_region: annotation.anatomical_region,
            reviewed_at: annotation.reviewed_at,
          }
        : null,
    });
  }
  const manifest = createManifest(dataset, activeItems, annotations);
  return {
    dataset: {
      id: dataset.id,
      version: dataset.version,
      status: dataset.status,
      manifest_hash: dataset.manifest_hash || null,
      manifest_item_count: dataset.manifest_item_count ?? null,
      manifest_hash_verified: dataset.status === 'sealed',
    },
    items,
    manifest: {
      ...manifest,
      sha256: hashManifest(manifest),
    },
  };
}

async function addImage(datasetId, input, user) {
  requireGovernance();
  const db = await getDb();
  const dataset = await db
    .collection('research_datasets')
    .findOne({ id: datasetId, status: 'open' });
  if (!dataset) throw fail(404, 'DATASET_NOT_OPEN', 'Open dataset not found');
  const image = await db.collection('oral_images').findOne({ id: input.image_id });
  if (!image) throw fail(404, 'IMAGE_NOT_FOUND', 'Screening image not found');
  const screening = await db.collection('oral_screenings').findOne({ id: image.screening_id });
  if (!screening) throw fail(404, 'SCREENING_NOT_FOUND', 'Image screening record not found');
  const consent = await db.collection('research_consents').findOne({
    id: input.consent_record_id,
    patient_id: screening.patient_id,
    status: 'granted',
    purpose: 'research_ai_training',
  });
  const latest = consent && (await latestResearchConsent(db, consent.patient_id));
  if (!consent || latest?.id !== consent.id || latest.status !== 'granted')
    throw fail(
      403,
      'RESEARCH_CONSENT_REQUIRED',
      'Explicit active research training consent is required',
    );
  const hash = subjectKey(screening.patient_id);
  const existing = await db
    .collection('research_dataset_items')
    .findOne({ dataset_id: datasetId, image_id: image.id });
  if (existing) throw fail(409, 'DATASET_ITEM_EXISTS', 'Image is already in this dataset version');
  const patientInSplit = await db
    .collection('research_dataset_items')
    .findOne({ dataset_id: datasetId, subject_key: hash, split: { $ne: input.split } });
  if (patientInSplit)
    throw fail(409, 'PATIENT_SPLIT_CONFLICT', 'A participant must remain in one dataset split');
  const now = new Date();
  const item = {
    id: randomUUID(),
    dataset_id: datasetId,
    dataset_version: dataset.version,
    image_id: image.id,
    patient_id: screening.patient_id,
    encrypted_object_id: image.encrypted_object_id || image.id,
    subject_key: hash,
    consent_record_id: consent.id,
    consent_version: consent.consent_version,
    split: input.split,
    annotation_status: 'pending',
    annotation_id: null,
    research_use_blocked: false,
    created_by: user.sub,
    created_at: now,
    updated_at: now,
  };
  await db.collection('research_dataset_items').insertOne(item);
  const verified = await latestResearchConsent(db, screening.patient_id);
  if (verified?.id !== consent.id || verified.status !== 'granted') {
    await db.collection('research_dataset_items').updateOne(
      { id: item.id },
      {
        $set: {
          research_use_blocked: true,
          research_use_blocked_at: new Date(),
          updated_at: new Date(),
        },
      },
    );
    throw fail(403, 'RESEARCH_CONSENT_REVOKED', 'Research consent was withdrawn before enrollment completed');
  }
  await audit(db, user, 'research.dataset_item_added', datasetId, {
    item_id: item.id,
    split: item.split,
  });
  return item;
}

async function annotate(itemId, input, user) {
  requireGovernance();
  const db = await getDb();
  const item = await db.collection('research_dataset_items').findOne({ id: itemId });
  if (!item) throw fail(404, 'DATASET_ITEM_NOT_FOUND', 'Research dataset item not found');
  if (!(await activeConsentForItem(db, item)))
    throw fail(409, 'RESEARCH_CONSENT_REVOKED', 'Active research consent is required for annotation');
  const dataset = await db
    .collection('research_datasets')
    .findOne({ id: item.dataset_id, status: 'open' });
  if (!dataset) throw fail(409, 'DATASET_SEALED', 'Dataset version is sealed and immutable');
  if (item.annotation_status !== 'pending' || item.annotation_id)
    throw fail(409, 'ANNOTATION_ALREADY_RECORDED', 'Dataset item already has an expert annotation');
  const annotation = {
    id: randomUUID(),
    item_id: item.id,
    labels: input.labels,
    anatomical_region: input.anatomical_region,
    annotation_status: 'expert_reviewed',
    reviewer_id: user.sub,
    reviewed_at: new Date(),
    created_at: new Date(),
  };
  try {
    await db.collection('research_annotations').insertOne(annotation);
  } catch (error) {
    if (error.code === 11000)
      throw fail(409, 'ANNOTATION_ALREADY_RECORDED', 'Dataset item already has an expert annotation');
    throw error;
  }
  const updated = await db.collection('research_dataset_items').updateOne(
    { id: itemId, annotation_status: 'pending', annotation_id: null },
    {
      $set: {
        annotation_status: 'expert_reviewed',
        annotation_id: annotation.id,
        updated_at: new Date(),
      },
    },
  );
  if (updated.modifiedCount !== 1)
    throw fail(409, 'ANNOTATION_ALREADY_RECORDED', 'Dataset item changed before annotation completed');
  await audit(db, user, 'research.annotation_reviewed', item.dataset_id, {
    item_id: item.id,
    annotation_id: annotation.id,
  });
  return {
    id: annotation.id,
    labels: annotation.labels,
    anatomical_region: annotation.anatomical_region,
    annotation_status: annotation.annotation_status,
    reviewed_at: annotation.reviewed_at,
  };
}

async function sealDataset(datasetId, user) {
  requireGovernance();
  const db = await getDb();
  const dataset = await db
    .collection('research_datasets')
    .findOne({ id: datasetId, status: 'open' });
  if (!dataset) throw fail(404, 'DATASET_NOT_OPEN', 'Open dataset not found');
  const items = await db
    .collection('research_dataset_items')
    .find({ dataset_id: datasetId })
    .toArray();
  if (items.some((item) => item.research_use_blocked))
    throw fail(409, 'RESEARCH_CONSENT_REVOKED', 'Withdrawn items must be excluded before sealing');
  const presentSplits = new Set(items.map((item) => item.split));
  if (['train', 'validation', 'test'].some((split) => !presentSplits.has(split))) {
    throw fail(
      409,
      'DATASET_SPLITS_INCOMPLETE',
      'Train, validation, and test splits must each contain data',
    );
  }
  for (const item of items) {
    const image = await db.collection('oral_images').findOne({ id: item.image_id });
    const screening =
      image && (await db.collection('oral_screenings').findOne({ id: image.screening_id }));
    const consent = screening && (await db.collection('research_consents').findOne({
      id: item.consent_record_id,
      patient_id: screening.patient_id,
      status: 'granted',
      purpose: 'research_ai_training',
    }));
    const latest =
      consent && (await latestResearchConsent(db, consent.patient_id));
    if (!consent || latest?.id !== consent.id || latest.status !== 'granted')
      throw fail(
        409,
        'RESEARCH_CONSENT_REVOKED',
        'Research consent must remain active to seal this dataset version',
      );
  }
  const annotations = new Map();
  for (const item of items) {
    const annotation = await db.collection('research_annotations').findOne({
      id: item.annotation_id,
      item_id: item.id,
      annotation_status: 'expert_reviewed',
    });
    if (
      item.annotation_status !== 'expert_reviewed' ||
      !annotation ||
      !Array.isArray(annotation.labels) ||
      !annotation.labels.length ||
      typeof annotation.reviewer_id !== 'string'
    ) {
      throw fail(
        409,
        'ANNOTATIONS_PENDING',
        'All dataset items need valid expert-reviewed annotations before sealing',
      );
    }
    annotations.set(item.id, annotation);
  }
  const manifest = createManifest(dataset, items, annotations);
  const now = new Date();
  const update = await db
    .collection('research_datasets')
    .updateOne(
      { id: datasetId, status: 'open' },
      {
        $set: {
          status: 'sealed',
          sealed_at: now,
          sealed_by: user.sub,
          manifest_version: 1,
          manifest_algorithm: 'sha256',
          manifest_hash: hashManifest(manifest),
          manifest_item_count: manifest.items.length,
          updated_at: now,
        },
      },
    );
  if (update.modifiedCount !== 1)
    throw fail(409, 'DATASET_SEAL_CONFLICT', 'Dataset changed before sealing completed');
  await audit(db, user, 'research.dataset_sealed', datasetId, { version: dataset.version });
  return {
    id: datasetId,
    status: 'sealed',
    sealed_at: now,
    manifest_version: 1,
    manifest_algorithm: 'sha256',
    manifest_hash: hashManifest(manifest),
    manifest_item_count: manifest.item_count,
  };
}

module.exports = {
  getResearchConsent,
  grantResearchConsent,
  withdrawResearchConsent,
  createDataset,
  listDatasets,
  listItems,
  addImage,
  annotate,
  sealDataset,
};
