const { z } = require('zod');

const languageCode = z.enum(['en', 'te', 'hi', 'or']);
const chatHistory = z.array(z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(2000),
}).strict()).max(8).default([]);

const listLanguages = z.object({
  query: z.object({
    lang: languageCode.optional(),
    namespace: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  }).strict(),
}).passthrough();

const updatePreference = z.object({
  body: z.object({ language_code: languageCode }).strict(),
}).passthrough();

const translate = z.object({
  body: z.object({
    text: z.string().trim().min(1).max(2000),
    source_lang: languageCode,
    target_lang: languageCode,
    mode: z.enum(['translate', 'explain_oral_health', 'patient_instruction', 'chat']).default('translate'),
    history: chatHistory.optional(),
  }).strict().refine((value) => value.mode === 'chat' || value.source_lang !== value.target_lang, {
    message: 'source_lang and target_lang must be different',
  }).refine((value) => value.mode === 'chat' || value.source_lang === 'en' || value.target_lang === 'en', {
    message: 'Only English-to-regional-language translation pairs are supported',
  }),
}).passthrough();

const speechToText = z.object({
  body: z.object({
    language: z.enum(['en-IN', 'te-IN', 'hi-IN', 'or-IN']),
    duration_seconds: z.coerce.number().positive().max(60).optional(),
  }).passthrough(),
}).passthrough();

const textToSpeech = z.object({
  body: z.object({
    text: z.string().trim().min(1).max(2000),
    language: z.enum(['en-IN', 'te-IN', 'hi-IN', 'or-IN']),
  }).strict(),
}).passthrough();

module.exports = { listLanguages, updatePreference, translate, speechToText, textToSpeech };
