#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createRecord(metadata, artifact) {
  if (
    !metadata ||
    !metadata.experiment_id ||
    !metadata.dataset_version ||
    !metadata.code_revision
  ) {
    throw new Error('experiment_id, dataset_version, and code_revision are required');
  }
  if (metadata.patient_level_split !== true || !Number.isInteger(metadata.seed)) {
    throw new Error('Patient-level splitting and a reproducible integer seed are required');
  }
  if (!Buffer.isBuffer(artifact) || artifact.length === 0)
    throw new Error('A real model artifact is required');
  if (metadata.test_labels_used_during_training === true)
    throw new Error('The independent test split cannot be used during training');
  return {
    record_type: 'research_experiment',
    clinical_validation_status: 'not_established',
    experiment_id: metadata.experiment_id,
    dataset_version: metadata.dataset_version,
    model_version: `sha256:${crypto.createHash('sha256').update(artifact).digest('hex')}`,
    code_revision: metadata.code_revision,
    seed: metadata.seed,
    patient_level_split: true,
    preprocessing: metadata.preprocessing || null,
    training_configuration: metadata.training_configuration || null,
    evaluation_report_path: metadata.evaluation_report_path || null,
    recorded_at: new Date().toISOString(),
  };
}

if (require.main === module) {
  try {
    const [metadataFile, artifactFile, outputFile] = process.argv.slice(2);
    if (!metadataFile || !artifactFile || !outputFile)
      throw new Error(
        'Usage: node record-experiment.js <metadata.json> <actual-model-artifact> <new-record.json>',
      );
    const record = createRecord(
      JSON.parse(fs.readFileSync(path.resolve(metadataFile), 'utf8')),
      fs.readFileSync(path.resolve(artifactFile)),
    );
    fs.writeFileSync(path.resolve(outputFile), `${JSON.stringify(record, null, 2)}\n`, {
      flag: 'wx',
    });
    process.stdout.write(`Wrote reproducible experiment record: ${outputFile}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createRecord };
