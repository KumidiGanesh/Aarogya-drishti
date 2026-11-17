const { z } = require('zod');

const uuid = z.string().uuid();
const date = z.string().date();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const paging = {
  page: z.string().regex(/^[1-9]\d*$/).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).optional(),
};

const createAppointment = z.object({
  body: z.object({
    patient_id: uuid,
    doctor_id: uuid,
    hospital_id: uuid.optional(),
    phc_id: uuid.optional(),
    appointment_date: date,
    time_slot: time,
    mode: z.enum(['in_person', 'audio', 'video']),
    reason: z.string().trim().min(1).max(2000),
    reminder_preferences: z.object({
      enabled: z.boolean().optional(),
      reminders_24h: z.boolean().optional(),
      reminders_2h: z.boolean().optional(),
    }).optional(),
  }).strict().refine((value) => Boolean(value.hospital_id) !== Boolean(value.phc_id), {
    message: 'Provide exactly one hospital_id or phc_id',
  }),
}).passthrough();

const listAppointments = z.object({
  query: z.object({
    ...paging,
    status: z.enum(['booked', 'confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show']).optional(),
    from: date.optional(),
    to: date.optional(),
    doctor_id: uuid.optional(),
    patient_id: uuid.optional(),
    hospital_id: uuid.optional(),
    phc_id: uuid.optional(),
    upcoming: z.enum(['true', 'false']).optional(),
    date: date.optional(),
    appointment_date: date.optional(),
    directory: z.enum(['true', 'false']).optional(),
    preferences: z.enum(['true', 'false']).optional(),
  }).strict()
    .refine((value) => !value.from || !value.to || value.from <= value.to, {
      message: 'Date range must be in ascending order',
    })
    .refine((value) => !value.date || !value.appointment_date || value.date === value.appointment_date, {
      message: 'date and appointment_date must match when both are provided',
    })
    .refine((value) => !(value.hospital_id && value.phc_id), {
      message: 'Choose either a hospital or a PHC',
    }),
}).passthrough();

const updateAppointment = z.object({
  params: z.object({ id: uuid }),
  body: z.discriminatedUnion('action', [
    z.object({
      action: z.literal('reschedule'),
      appointment_date: date,
      time_slot: time,
    }).strict(),
    z.object({
      action: z.literal('cancel'),
      reason: z.string().trim().min(1).max(1000),
    }).strict(),
    z.object({ action: z.enum(['confirm', 'complete', 'no_show']) }).strict(),
    z.object({
      action: z.literal('reminder_preferences'),
      enabled: z.boolean(),
      reminders_24h: z.boolean(),
      reminders_2h: z.boolean(),
    }).strict(),
  ]),
}).passthrough();

const appointmentParams = z.object({ params: z.object({ id: uuid }) }).passthrough();

module.exports = {
  createAppointment,
  listAppointments,
  updateAppointment,
  appointmentParams,
};
