const { z } = require('zod');

const uuid = z.string().uuid();
const language = z.enum(['en', 'te', 'hi', 'or']);
const list = (max = 40) => z.array(z.string().trim().min(1).max(160)).max(max).default([]);
const consentTypes = z.enum([
  'data_collection',
  'aadhaar_documents',
  'photo',
  'location',
  'teleconsultation',
  'ai_processing',
  'research_ai_training',
]);
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

const patientHistory = z
  .object({
    conditions: list(),
    allergies: list(),
    current_medications: list(),
  })
  .default({});

const useHistoryFields = {
  tobacco_use: z.boolean().default(false),
  tobacco_duration_months: z.number().int().min(0).max(1200).nullable().optional(),
  tobacco_frequency_per_day: z.number().min(0).max(200).nullable().optional(),
  gutkha_use: z.boolean().default(false),
  gutkha_duration_months: z.number().int().min(0).max(1200).nullable().optional(),
  gutkha_frequency_per_day: z.number().min(0).max(200).nullable().optional(),
  areca_nut_use: z.boolean().default(false),
  areca_nut_duration_months: z.number().int().min(0).max(1200).nullable().optional(),
  areca_nut_frequency_per_day: z.number().min(0).max(200).nullable().optional(),
};

const registrationBodySchema = z
  .object({
    full_name: z.string().trim().min(2).max(160),
    age: z.number().int().min(0).max(120).nullable().optional(),
    date_of_birth: z.string().date().optional(),
    gender: z.enum(['female', 'male', 'non_binary', 'undisclosed']).nullable().optional(),
    mobile: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
    village_id: uuid.optional().nullable(),
    village_name: z.string().trim().min(1).max(120).optional(),
    gram_panchayat: z.string().trim().max(120).default(''),
    district: z.string().trim().min(1).max(100),
    state: z.string().trim().max(100).default('Andhra Pradesh'),
    mandal: z.string().trim().min(1).max(100),
    phc_id: uuid.optional().nullable(),
    phc_name: z.string().trim().min(1).max(160).optional(),
    address: z.string().trim().max(500).default(''),
    aadhaar_last4: z.string().regex(/^\d{4}$/).optional(),
    aadhaar_upload_ids: z.array(uuid).max(2).default([]),
    aadhaar_consent: z.object({ given: z.literal(true), language }).optional(),
    medical_history: patientHistory,
    ...useHistoryFields,
    current_symptoms: list(30),
    consent: z.object({ given: z.boolean(), language }),
    client_uuid: uuid,
    force: z.boolean().default(false),
    justification: z.string().trim().min(10).max(500).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.village_id || value.village_name), {
    message: 'Provide a village name or village ID',
    path: ['village_name'],
  })
  .refine((value) => Boolean(value.phc_id || value.phc_name), {
    message: 'Provide a PHC name or PHC ID',
    path: ['phc_name'],
  })
  .refine((value) => !value.force || Boolean(value.justification), {
    message: 'A justification is required to continue past a possible duplicate',
    path: ['justification'],
  })
  .refine((value) => {
    const hasAadhaarData = Boolean(value.aadhaar_last4 || value.aadhaar_upload_ids.length);
    return !hasAadhaarData || Boolean(value.aadhaar_consent?.given);
  }, {
    message: 'Explicit Aadhaar consent is required for Aadhaar details or documents',
    path: ['aadhaar_consent'],
  });

const registrationSchema = z
  .object({
    body: registrationBodySchema,
    params: z.object({}).passthrough(),
    query: z.object({}).passthrough(),
  })
  .passthrough();

const listQuerySchema = z
  .object({
    ...pageFields,
    search: z.string().trim().max(160).optional(),
    name: z.string().trim().max(160).optional(),
    patient_code: z.string().trim().max(30).optional(),
    mobile: z.string().trim().max(20).optional(),
    village: z.string().trim().max(120).optional(),
    mandal: z.string().trim().max(100).optional(),
    district: z.string().trim().max(100).optional(),
    phc: z.string().trim().max(160).optional(),
    age_min: z
      .string()
      .regex(/^\d{1,3}$/)
      .optional(),
    age_max: z
      .string()
      .regex(/^\d{1,3}$/)
      .optional(),
    gender: z.enum(['female', 'male', 'non_binary', 'undisclosed']).optional(),
    tobacco_use: z.enum(['true', 'false']).optional(),
    gutkha_use: z.enum(['true', 'false']).optional(),
    areca_nut_use: z.enum(['true', 'false']).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  })
  .strict()
  .refine(
    (value) =>
      (!value.age_min || !value.age_max || Number(value.age_min) <= Number(value.age_max)) &&
      (!value.from || !value.to || value.from <= value.to),
    { message: 'Age and date ranges must be in ascending order' },
  );

const listSchema = z
  .object({
    query: listQuerySchema,
    params: z.object({}).passthrough(),
    body: z.unknown().optional(),
  })
  .passthrough();

const idParams = z.object({ params: z.object({ id: uuid }) }).passthrough();
const aadhaarUploadParams = z.object({ params: z.object({ uploadId: uuid }) }).passthrough();
const aadhaarDocumentParams = z.object({ params: z.object({ id: uuid, documentId: uuid }) }).passthrough();

const emergencyDetails = z
  .object({
    full_name: z.string().trim().min(2).max(160),
    mobile: z.string().regex(/^[6-9]\d{9}$/),
    relationship: z.string().trim().max(80).default(''),
  })
  .strict();

const updateSchema = z
  .object({
    body: z
      .object({
        full_name: z.string().trim().min(2).max(160).optional(),
        age: z.number().int().min(0).max(120).nullable().optional(),
        gender: z.enum(['female', 'male', 'non_binary', 'undisclosed']).nullable().optional(),
        mobile: z
          .string()
          .regex(/^[6-9]\d{9}$/)
          .optional(),
        village_id: uuid.nullable().optional(),
        village_name: z.string().trim().min(1).max(120).optional(),
        gram_panchayat: z.string().trim().max(120).optional(),
        district: z.string().trim().min(1).max(100).optional(),
        mandal: z.string().trim().min(1).max(100).optional(),
        phc_id: uuid.nullable().optional(),
        phc_name: z.string().trim().min(1).max(160).optional(),
        address: z.string().trim().max(500).optional(),
        preferred_language: language.optional(),
        medical_history: z
          .object({
            conditions: list().optional(),
            allergies: list().optional(),
            current_medications: list().optional(),
          })
          .strict()
          .optional(),
        ...Object.fromEntries(
          Object.entries(useHistoryFields).map(([key, schema]) => [key, schema.optional()]),
        ),
        current_symptoms: list(30).optional(),
        emergency_details: emergencyDetails.nullable().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: 'At least one field must be provided',
      }),
    params: z.object({ id: uuid }),
  })
  .passthrough();

const deleteSchema = z
  .object({
    body: z.object({ reason: z.string().trim().min(5).max(500) }).strict(),
    params: z.object({ id: uuid }),
  })
  .passthrough();

const historySchema = z
  .object({
    params: z.object({ id: uuid }),
    query: z
      .object({
        ...pageFields,
        type: z
          .enum([
            'registration',
            'history_change',
            'screening',
            'ai_result',
            'clinical_review',
            'referral',
            'appointment',
            'consultation',
            'follow_up',
            'medicine_adherence',
          ])
          .optional(),
      })
      .strict(),
  })
  .passthrough();

const consentSchema = z
  .object({
    body: z
      .object({
        consent_type: consentTypes,
        granted: z.boolean(),
        version: z.number().int().min(1).max(100),
        language,
      })
      .strict(),
    params: z.object({ id: uuid }),
  })
  .passthrough();

module.exports = {
  registrationSchema,
  listSchema,
  idParams,
  aadhaarUploadParams,
  aadhaarDocumentParams,
  updateSchema,
  deleteSchema,
  historySchema,
  consentSchema,
};
