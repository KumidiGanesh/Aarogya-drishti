'use strict';

const { z } = require('zod');

const box = z
  .object({
    x_min: z.number().min(0).max(1),
    y_min: z.number().min(0).max(1),
    x_max: z.number().min(0).max(1),
    y_max: z.number().min(0).max(1),
  })
  .strict()
  .refine(
    (value) => value.x_max > value.x_min && value.y_max > value.y_min,
    'Bounding box must have positive area',
  );
const modelOutput = z
  .object({
    analysis_status: z.enum(['completed', 'inconclusive']),
    image_analyzed: z.boolean(),
    visible_observations: z
      .array(
        z
          .object({
            type: z.enum([
              'white_area',
              'red_area',
              'ulcer_like_area',
              'unusual_surface_change',
              'other',
            ]),
            location: z.string().min(1).max(160),
            description: z.string().min(1).max(700),
            image_id: z.string().uuid().optional(),
            localization: box.optional(),
            confidence: z.number().min(0).max(1).optional(),
            confidence_interpretation: z
              .enum(['uncalibrated_model_score', 'calibrated'])
              .optional(),
            segmentation_ref: z.string().min(1).max(256).optional(),
          })
          .strict(),
      )
      .max(12),
    oral_region_detected: z.boolean().nullable(),
    image_limitations: z.array(z.string().min(1).max(300)).max(8),
    uncertainty: z.array(z.string().min(1).max(300)).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.analysis_status === 'completed' && !value.image_analyzed)
      context.addIssue({
        code: 'custom',
        message: 'Completed inference must confirm image processing',
      });
    if (!value.image_analyzed && value.visible_observations.length)
      context.addIssue({
        code: 'custom',
        message: 'An unprocessed image cannot have visual observations',
      });
    value.visible_observations.forEach((item, index) => {
      if (
        /\b(cancer|carcinoma|malignant|benign|diagnos(?:is|e|ed)|tumou?r|stage\s*[0-4iv]+|leukoplakia|erythroplakia)\b/i.test(
          `${item.location} ${item.description}`,
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['visible_observations', index],
          message: 'Diagnostic claims are unsupported by this screening provider contract',
        });
      if (item.confidence !== undefined && !item.confidence_interpretation)
        context.addIssue({
          code: 'custom',
          path: ['visible_observations', index, 'confidence_interpretation'],
          message: 'Model confidence must be explicitly characterized',
        });
    });
  });

function normalizeProviderResult(result, providerName) {
  const parsed = modelOutput.safeParse(result?.report || result);
  if (!parsed.success) {
    const error = new Error('Vision provider returned an invalid result');
    error.status = 502;
    error.code = 'VISION_PROVIDER_INVALID_RESULT';
    throw error;
  }
  return {
    ...result,
    report: {
      ...parsed.data,
      model_provider: result?.model_provider || providerName,
      model_version: result?.model_version || 'unknown',
      clinical_validation_status: 'not_validated',
    },
  };
}

module.exports = { modelOutput, normalizeProviderResult };
