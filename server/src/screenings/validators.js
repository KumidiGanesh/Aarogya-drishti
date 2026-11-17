const { z } = require('zod');

const uuid = z.string().uuid();
const severity = z.enum(['mild', 'moderate', 'severe']);
const symptom = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{2,60}$/),
    severity,
    duration_days: z.number().int().min(0).max(36500),
    entered_via: z.enum(['typed', 'voice']),
  })
  .strict();
const pageFields = {
  page: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
};

const screeningCreate = z
  .object({
    body: z
      .object({
        patient_id: uuid,
        symptoms: z.array(symptom).min(1).max(30),
        notes: z.string().trim().max(2000).default(''),
        client_uuid: uuid,
      })
      .strict(),
  })
  .passthrough();

const listScreenings = z
  .object({
    query: z
      .object({
        ...pageFields,
        search: z.string().trim().min(1).max(120).optional(),
        patient_id: uuid.optional(),
        status: z
          .enum([
            'draft',
            'pending',
            'images_uploaded',
            'ai_completed',
            'in_review',
            'reviewed',
            'referred',
            'closed',
          ])
          .optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        village: z.string().trim().min(1).max(120).optional(),
        phc: z.string().trim().min(1).max(160).optional(),
      })
      .strict()
      .refine((value) => !value.from || !value.to || value.from <= value.to, {
        message: 'Date range must be in ascending order',
      }),
  })
  .passthrough();

const screeningParams = z
  .object({
    params: z.object({ id: uuid }),
    query: z.object({ image_id: uuid.optional() }).strict().optional(),
  })
  .passthrough();

const doctorRequest = z
  .object({
    params: z.object({ id: uuid }),
    body: z.object({ doctor_id: uuid }).strict(),
  })
  .passthrough();

const doctorRequestStatus = z
  .object({
    params: z.object({ id: uuid }),
    body: z.object({ status: z.literal('under_review') }).strict(),
  })
  .passthrough();

const uploadImages = z
  .object({
    params: z.object({ id: uuid }),
    body: z
      .object({
        site: z
          .enum(['front', 'left_cheek', 'right_cheek', 'tongue', 'upper_gum', 'lower_gum', 'other'])
          .default('other'),
        accept_low_quality: z.enum(['true', 'false']).default('false'),
      })
      .passthrough(),
  })
  .passthrough();

const clinicalReview = z
  .object({
    params: z.object({ id: uuid }),
    body: z
      .object({
        observations: z.string().trim().min(1).max(5000),
        provisional_notes: z.string().trim().max(5000).default(''),
        follow_up_recommendation: z.string().trim().max(2000).optional(),
        follow_up_date: z.string().date().optional(),
        recommend_referral: z.boolean().default(false),
        recommended_investigations: z.array(z.string().trim().min(1).max(240)).max(30).default([]),
        ai_observation_decisions: z
          .array(
            z
              .object({
                observation_index: z.number().int().min(0).max(11),
                decision: z.enum(['accepted', 'rejected', 'corrected']),
                correction: z.string().trim().max(700).default(''),
              })
              .strict()
              .refine((item) => item.decision !== 'corrected' || item.correction.length > 0, {
                message: 'A correction is required when correcting an AI observation',
                path: ['correction'],
              }),
          )
          .max(12)
          .default([]),
        review_status: z.enum(['pending', 'in_review', 'completed', 'needs_more_info']),
      })
      .strict(),
  })
  .passthrough();

module.exports = {
  screeningCreate,
  listScreenings,
  screeningParams,
  doctorRequest,
  doctorRequestStatus,
  uploadImages,
  clinicalReview,
};
