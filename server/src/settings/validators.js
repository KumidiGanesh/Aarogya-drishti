const { z } = require('zod');

const updateSettings = z.object({
  body: z.object({
    language: z.enum(['en', 'te', 'hi', 'or']).optional(),
    notification_preferences: z.object({
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
    }).optional(),
    privacy: z.record(z.string(), z.boolean()).optional(),
    font_size: z.enum(['small', 'medium', 'large', 'extra-large']).optional(),
    voice: z.object({
      enabled: z.boolean().optional(),
      language: z.enum(['en-IN', 'te-IN', 'hi-IN', 'or-IN']).optional(),
      speed: z.number().min(0.5).max(2).optional(),
    }).strict().optional(),
    account: z.object({
      full_name: z.string().trim().min(1).max(160).optional(),
      mobile: z.string().regex(/^[6-9]\d{9}$/).optional(),
      email: z.union([z.string().email().max(254), z.literal(''), z.null()]).optional(),
    }).strict().optional(),
    system_settings: z.record(z.string().min(1).max(100), z.unknown()).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, {
    message: 'At least one setting must be provided',
  }),
}).passthrough();

module.exports = { updateSettings };
