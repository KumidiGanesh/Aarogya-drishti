const crypto = require('node:crypto');
const { createRecord } = require('../../../research/oral-cv/record-experiment');

describe('research experiment records', () => {
  it('hashes an actual artifact and records patient-level reproducibility metadata', () => {
    const artifact = Buffer.from('supplied-artifact-bytes');
    const record = createRecord(
      {
        experiment_id: 'exp-1',
        dataset_version: 'dataset-v1',
        code_revision: 'abc123',
        seed: 42,
        patient_level_split: true,
      },
      artifact,
    );
    expect(record.model_version).toBe(
      `sha256:${crypto.createHash('sha256').update(artifact).digest('hex')}`,
    );
    expect(record.clinical_validation_status).toBe('not_established');
  });
  it('rejects absent artifacts, non patient-level split, and test leakage', () => {
    expect(() =>
      createRecord(
        {
          experiment_id: 'exp',
          dataset_version: 'd',
          code_revision: 'abc',
          seed: 0,
          patient_level_split: true,
        },
        Buffer.alloc(0),
      ),
    ).toThrow(/artifact/);
    expect(() =>
      createRecord(
        { experiment_id: 'exp', dataset_version: 'd', code_revision: 'abc', seed: 0 },
        Buffer.from('x'),
      ),
    ).toThrow(/Patient-level/);
    expect(() =>
      createRecord(
        {
          experiment_id: 'exp',
          dataset_version: 'd',
          code_revision: 'abc',
          seed: 0,
          patient_level_split: true,
          test_labels_used_during_training: true,
        },
        Buffer.from('x'),
      ),
    ).toThrow(/independent test/);
  });
});
