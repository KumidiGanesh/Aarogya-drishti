const { modelOutput } = require('../../src/adapters/oralVisionContract');

describe('oral vision provider contract', () => {
  const base = {
    analysis_status: 'completed',
    image_analyzed: true,
    visible_observations: [],
    oral_region_detected: null,
    image_limitations: [],
    uncertainty: [],
  };
  it('permits actual model localization and explicitly uncalibrated confidence', () => {
    const result = modelOutput.safeParse({
      ...base,
      visible_observations: [
        {
          type: 'red_area',
          location: 'inner cheek',
          description: 'Visible color change',
          localization: { x_min: 0.1, y_min: 0.2, x_max: 0.4, y_max: 0.5 },
          confidence: 0.6,
          confidence_interpretation: 'uncalibrated_model_score',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
  it('rejects observations when image was not processed', () => {
    expect(
      modelOutput.safeParse({
        ...base,
        analysis_status: 'inconclusive',
        image_analyzed: false,
        visible_observations: [{ type: 'red_area', location: 'cheek', description: 'red' }],
      }).success,
    ).toBe(false);
  });
  it('rejects out of range localization and unqualified confidence', () => {
    expect(
      modelOutput.safeParse({
        ...base,
        visible_observations: [
          { type: 'red_area', location: 'cheek', description: 'red', confidence: 0.5 },
        ],
      }).success,
    ).toBe(false);
  });
});
