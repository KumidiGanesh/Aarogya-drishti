const { z } = require('zod');

const chat = z.object({
  body: z.object({
    text: z.string().trim().min(1).max(2000),
    language: z.enum(['en', 'te', 'hi', 'or']),
    history: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      text: z.string().trim().min(1).max(2000),
    }).strict()).max(8).default([]),
  }).strict(),
}).passthrough();

module.exports = { chat };
