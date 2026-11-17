const { z } = require('zod');

const paging = {
  page: z.string().regex(/^[1-9]\d*$/).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).optional(),
};

const listNotifications = z.object({
  query: z.object({
    ...paging,
    type: z.enum(['appointment', 'medicine', 'referral', 'consultation', 'followup', 'emergency', 'registration']).optional(),
    is_read: z.enum(['true', 'false']).optional(),
    date: z.string().date().optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  }).strict().refine(({ from, to }) => !from || !to || from <= to, {
    message: 'from must not be after to',
  }),
}).passthrough();

const notificationId = z.object({
  params: z.object({ id: z.union([z.literal('all'), z.string().uuid()]) }),
}).passthrough();

const updatePreferences = z.object({
  body: z.object({
    types: z.record(z.string(), z.boolean()).optional(),
    channels: z.object({
      in_app: z.boolean().optional(),
      sms: z.boolean().optional(),
      push: z.boolean().optional(),
    }).strict().optional(),
    quiet_hours: z.object({
      enabled: z.boolean(),
      start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    }).strict().optional(),
  }).strict(),
}).passthrough();

module.exports = { listNotifications, notificationId, updatePreferences };
