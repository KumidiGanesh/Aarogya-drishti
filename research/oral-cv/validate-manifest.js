#!/usr/bin/env node
'use strict';

// Validate a research manifest without opening/copying clinical images. It must contain
// opaque encrypted-object references and consent/annotation provenance, never patient identifiers.
const fs = require('node:fs');
const path = require('node:path');

function validate(entries) {
  if (!Array.isArray(entries) || entries.length === 0)
    throw new Error('Manifest must be a non-empty JSON array');
  const ids = new Set();
  const patientSplits = new Map();
  for (const [index, entry] of entries.entries()) {
    const at = `entry ${index + 1}`;
    for (const field of [
      'item_id',
      'subject_key',
      'encrypted_object_id',
      'consent_record_id',
      'annotation_id',
    ]) {
      if (typeof entry[field] !== 'string' || !entry[field].trim())
        throw new Error(`${at}: ${field} is required`);
    }
    if (
      ['patient_id', 'patient_name', 'mobile', 'email', 'screening_id'].some(
        (field) => field in entry,
      )
    ) {
      throw new Error(`${at}: direct identifiers and clinical record identifiers are prohibited`);
    }
    if (!['train', 'validation', 'test'].includes(entry.split))
      throw new Error(`${at}: invalid split`);
    if (
      !entry.consent_granted ||
      entry.annotation_status !== 'expert_reviewed' ||
      !entry.reviewer_key
    ) {
      throw new Error(
        `${at}: active research consent and expert-reviewed annotation provenance are required`,
      );
    }
    if (ids.has(entry.item_id)) throw new Error(`${at}: duplicate item_id`);
    ids.add(entry.item_id);
    const previous = patientSplits.get(entry.subject_key);
    if (previous && previous !== entry.split)
      throw new Error(`${at}: subject appears in multiple splits`);
    patientSplits.set(entry.subject_key, entry.split);
  }
  return {
    entries: entries.length,
    subjects: patientSplits.size,
    splits: [...new Set(entries.map((item) => item.split))].sort(),
  };
}

if (require.main === module) {
  try {
    const filename = process.argv[2];
    if (!filename) throw new Error('Usage: node validate-manifest.js <manifest.json>');
    const result = validate(JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8')));
    process.stdout.write(`${JSON.stringify({ valid: true, ...result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { validate };
