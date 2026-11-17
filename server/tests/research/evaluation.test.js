const { metrics, evaluate } = require('../../../research/oral-cv/evaluate');

const provenance = {
  item_id: 'i1',
  subject_key: 's1',
  encrypted_object_id: 'o1',
  consent_record_id: 'c1',
  consent_granted: true,
  annotation_id: 'a1',
  annotation_status: 'expert_reviewed',
  reviewer_key: 'r1',
  split: 'test',
  label: 1,
  probability: 0.8,
  independent_test: true,
};

describe('research oral CV evaluation', () => {
  it('calculates metrics from measured supplied test labels and scores', () => {
    const report = evaluate(
      [provenance, { ...provenance, item_id: 'i2', subject_key: 's2', label: 0, probability: 0.2 }],
      { independent_test: true, dataset_version: 'd1', model_version: 'm1' },
    );
    expect(report.overall.sensitivity).toBe(1);
    expect(report.overall.specificity).toBe(1);
    expect(report.overall.auroc).toBe(1);
    expect(report.clinical_validation_status).toBe('not_established');
  });
  it('rejects subject leakage and missing independent-test evidence', () => {
    expect(() =>
      evaluate([provenance, { ...provenance, item_id: 'i2', split: 'train' }], {
        independent_test: true,
        dataset_version: 'd',
        model_version: 'm',
      }),
    ).toThrow(/multiple splits/);
    expect(() => metrics([])).toThrow(/empty/);
  });
  it('uses average ranks for tied scores when computing AUROC', () => {
    expect(
      metrics([
        { label: 1, probability: 0.5 },
        { label: 0, probability: 0.5 },
      ]).auroc,
    ).toBe(0.5);
  });
});
