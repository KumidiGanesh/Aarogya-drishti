'use strict';

const { createHash, createHmac } = require('node:crypto');

function reviewerKey(reviewerId) {
  const secret = process.env.RESEARCH_SUBJECT_HMAC_KEY;
  if (!secret || secret.length < 32) {
    const error = new Error('Research de-identification key is not configured');
    error.status = 503;
    error.code = 'RESEARCH_KEY_NOT_CONFIGURED';
    throw error;
  }
  return createHmac('sha256', secret).update(`reviewer:${reviewerId}`).digest('hex');
}

function createManifest(dataset, items, annotations) {
  const entries = items
    .map((item) => {
      const annotation = annotations.get(item.id);
      return {
        item_id: item.id,
        subject_key: item.subject_key,
        encrypted_object_id: item.encrypted_object_id,
        consent_record_id: item.consent_record_id,
        consent_granted: true,
        split: item.split,
        annotation_id: annotation?.id || '',
        annotation_status: item.annotation_status,
        reviewer_key: annotation?.reviewer_id ? reviewerKey(annotation.reviewer_id) : '',
        labels: annotation?.labels || [],
        anatomical_region: annotation?.anatomical_region || null,
      };
    })
    .sort((left, right) => left.item_id.localeCompare(right.item_id));
  return {
    schema_version: '1.0',
    dataset_id: dataset.id,
    dataset_version: dataset.version,
    item_count: entries.length,
    items: entries,
  };
}

function hashManifest(manifest) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

module.exports = { createManifest, hashManifest };
