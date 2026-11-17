const { z } = require('zod');

const uuid = z.string().uuid();
const date = z.string().date();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const paging = {
  page: z.string().regex(/^[1-9]\d*$/).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).optional(),
};

const createMedicine = z.object({
  body: z.object({
    patient_id: uuid,
    name: z.string().trim().min(1).max(200),
    dosage: z.string().trim().min(1).max(200),
    form: z.string().trim().min(1).max(80),
    instructions: z.string().trim().max(2000).default(''),
  }).strict(),
}).passthrough();

const listMedicines = z.object({
  query: z.object({
    ...paging,
    patient_id: uuid.optional(),
    is_active: z.enum(['true', 'false']).optional(),
    search: z.string().trim().max(200).optional(),
  }).strict(),
}).passthrough();

const createReminder = z.object({
  body: z.object({
    medicine_id: uuid,
    frequency: z.enum(['once_daily', 'twice_daily', 'thrice_daily', 'custom']),
    reminder_times: z.array(time).min(1).max(10),
    start_date: date,
    end_date: date.optional(),
    channel: z.enum(['in_app', 'sms', 'push', 'all']).default('in_app'),
  }).strict().refine((value) => !value.end_date || value.end_date >= value.start_date, {
    message: 'end_date must be on or after start_date',
  }).refine((value) => {
    const expected = { once_daily: 1, twice_daily: 2, thrice_daily: 3 }[value.frequency];
    return expected === undefined || value.reminder_times.length === expected;
  }, { message: 'reminder_times must match the selected frequency' })
    .refine((value) => new Set(value.reminder_times).size === value.reminder_times.length, {
      message: 'reminder_times cannot contain duplicates',
    }),
}).passthrough();

const listReminders = z.object({
  query: z.object({
    ...paging,
    patient_id: uuid.optional(),
    status: z.enum(['active', 'inactive']).optional(),
    from: date.optional(),
    to: date.optional(),
  }).strict(),
}).passthrough();

const createLog = z.object({
  body: z.object({
    reminder_id: uuid,
    scheduled_for: z.string().datetime({ offset: true }),
    status: z.enum(['taken', 'missed']),
    notes: z.string().trim().max(1000).default(''),
  }).strict(),
}).passthrough();

const listLogs = z.object({
  query: z.object({
    ...paging,
    patient_id: uuid.optional(),
    medicine_id: uuid.optional(),
    status: z.enum(['pending', 'taken', 'missed']).optional(),
    from: date.optional(),
    to: date.optional(),
    summary: z.enum(['true', 'false']).optional(),
  }).strict(),
}).passthrough();

module.exports = {
  createMedicine,
  listMedicines,
  createReminder,
  listReminders,
  createLog,
  listLogs,
};
