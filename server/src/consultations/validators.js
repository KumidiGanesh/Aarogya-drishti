const { z } = require('zod');

const uuid = z.string().uuid();
const paging = {
  page: z.string().regex(/^[1-9]\d*$/).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).optional(),
};

const createConsultation = z.object({
  body: z.discriminatedUnion('action', [
    z.object({ action: z.literal('schedule'), appointment_id: uuid }).strict(),
    z.object({ action: z.enum(['start', 'end', 'join']), consultation_id: uuid }).strict(),
    z.object({
      action: z.literal('add_note'),
      consultation_id: uuid,
      note: z.string().trim().min(1).max(4000),
      follow_up_recommendation: z.string().trim().max(2000).optional(),
      follow_up_date: z.string().date().optional(),
    }).strict(),
  ]),
}).passthrough();

const listConsultations = z.object({
  query: z.object({
    ...paging,
    status: z.enum(['scheduled', 'waiting', 'in_progress', 'completed', 'cancelled', 'missed']).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    doctor_id: uuid.optional(),
    patient_id: uuid.optional(),
    availability: z.enum(['true', 'false']).optional(),
  }).strict().refine(({ from, to }) => !from || !to || from <= to, {
    message: 'from must not be after to',
  }),
}).passthrough();

const consultationParams = z.object({
  params: z.object({ id: uuid }),
}).passthrough();

const consultationCall = z.object({
  params: z.object({ id: uuid }),
  body: z.discriminatedUnion('action', [
    z.object({ action: z.literal('initiate') }).strict(),
    z.object({
      action: z.enum(['accept', 'reject', 'end', 'missed']),
      call_id: uuid,
    }).strict(),
  ]),
}).passthrough();

module.exports = {
  createConsultation,
  listConsultations,
  consultationParams,
  consultationCall,
};
