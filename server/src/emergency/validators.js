const { z } = require('zod');

const uuid = z.string().uuid();
const coordinates = {
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
};
const paging = {
  page: z.string().regex(/^[1-9]\d*$/).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).optional(),
};

const createSos = z.object({
  body: z.object({
    patient_id: uuid.optional(),
    location_consent: z.boolean(),
    ...coordinates,
    contact_ids: z.array(uuid).max(5).default([]),
    notes: z.string().trim().max(1000).default(''),
  }).strict().refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: 'latitude and longitude must be supplied together',
  }),
}).passthrough();

const getContacts = z.object({
  query: z.object({
    ...paging,
    patient_id: uuid.optional(),
    include: z.enum(['requests']).optional(),
  }).strict(),
}).passthrough();

const addContact = z.object({
  body: z.object({
    patient_id: uuid.optional(),
    name: z.string().trim().min(1).max(160),
    relationship: z.string().trim().min(1).max(80),
    mobile: z.string().trim().regex(/^(?:\+91[\s-]?)?[6-9]\d{9}$/, 'Enter a valid Indian mobile number'),
    is_primary: z.boolean().default(false),
  }).strict(),
}).passthrough();

const updateContact = z.object({
  body: z.object({
    action: z.literal('update'),
    patient_id: uuid.optional(),
    contact_id: uuid,
    name: z.string().trim().min(1).max(160).optional(),
    relationship: z.string().trim().min(1).max(80).optional(),
    mobile: z.string().trim().regex(/^(?:\+91[\s-]?)?[6-9]\d{9}$/, 'Enter a valid Indian mobile number').optional(),
    is_primary: z.boolean().optional(),
  }).strict().refine((value) => ['name', 'relationship', 'mobile', 'is_primary']
    .some((key) => value[key] !== undefined), {
    message: 'Provide at least one contact field to update',
  }),
}).passthrough();

const nearbyHospitals = z.object({
  query: z.object({
    ...paging,
    patient_id: uuid.optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius_km: z.coerce.number().min(1).max(500).default(50),
    district: z.string().trim().min(1).max(120).optional(),
  }).strict()
    .refine((value) => {
      const latitude = value.latitude ?? value.lat;
      const longitude = value.longitude ?? value.lng;
      return (latitude === undefined) === (longitude === undefined);
    }, { message: 'latitude and longitude must be supplied together' })
    .refine((value) => !(value.latitude !== undefined && value.lat !== undefined), {
      message: 'Use either latitude/longitude or lat/lng',
    }),
}).passthrough();

module.exports = {
  createSos,
  getContacts,
  createContact: z.union([addContact, updateContact]),
  nearbyHospitals,
};
