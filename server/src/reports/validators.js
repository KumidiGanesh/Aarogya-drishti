const { z } = require('zod');

const analytics = z.object({
  query: z.object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    district: z.string().trim().min(1).max(100).optional(),
    phc_id: z.string().uuid().optional(),
    export: z.enum(['csv', 'pdf']).optional(),
  }).strict().refine(({ from, to }) => !from || !to || from <= to, {
    message: 'from must not be after to',
  }),
}).passthrough();

module.exports = { analytics };
