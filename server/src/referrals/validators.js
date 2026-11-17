const { z } = require('zod');

const uuid = z.string().uuid();
const date = z.string().date();
const pageFields = {
  page: z.string().regex(/^[1-9]\d*$/).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).optional(),
};
const stringArray = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  }
}, z.array(z.string().trim().min(1).max(240)).max(30));

const referralAction = z.object({
  body: z.discriminatedUnion('action', [
    z.object({
      action: z.literal('create'),
      patient_id: uuid,
      screening_id: uuid.optional(),
      specialist_id: uuid,
      referral_hospital_id: uuid,
      reason: z.string().trim().min(1).max(3000),
      urgency: z.enum(['routine', 'soon', 'urgent']),
    }).strict(),
    z.object({
      action: z.literal('update_status'),
      referral_id: uuid,
      status: z.enum(['accepted', 'in_progress', 'completed', 'rejected']),
      note: z.string().trim().max(2000).default(''),
    }).strict(),
    z.object({
      action: z.literal('specialist_feedback'),
      referral_id: uuid,
      feedback: z.string().trim().min(1).max(5000),
      recommended_investigations: stringArray.default([]),
    }).strict(),
    z.object({
      action: z.literal('follow_up'),
      referral_id: uuid,
      follow_up_date: date,
      follow_up_status: z.enum(['scheduled', 'completed', 'missed', 'cancelled']),
      notes: z.string().trim().max(3000).default(''),
    }).strict(),
  ]),
}).passthrough();

const listReferrals = z.object({
  query: z.object({
    ...pageFields,
    status: z.enum(['pending', 'accepted', 'in_review', 'in_progress', 'completed', 'rejected']).optional(),
    urgency: z.enum(['routine', 'soon', 'urgent']).optional(),
    hospital_id: uuid.optional(),
    specialist_id: uuid.optional(),
    patient_id: uuid.optional(),
    from: date.optional(),
    to: date.optional(),
    download: uuid.optional(),
    directory: z.enum(['true', 'false']).optional(),
  }).strict().refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'Date range must be in ascending order',
  }),
}).passthrough();

module.exports = { referralAction, listReferrals };
