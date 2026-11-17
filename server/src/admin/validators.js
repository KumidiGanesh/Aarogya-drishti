const { z } = require('zod');
const { ALL_PERMISSIONS, ROLE_NAMES } = require('../auth/permissions');

const uuid = z.string().uuid();
const password = z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/);
const language = z.enum(['en', 'te', 'hi', 'or']).default('en');
const accountRole = z.enum(['super_admin', 'admin', 'doctor', 'health_worker', 'specialist']);
const availability = z.record(
  z.string().regex(/^[0-6]$/),
  z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/))
    .max(24)
    .refine((slots) => new Set(slots).size === slots.length, 'Availability slots must be unique'),
);
const querySchema = (schema) =>
  z
    .object({
      query: schema,
      params: z.object({}).passthrough(),
      body: z.unknown().optional(),
    })
    .passthrough();
const bodySchema = (schema) =>
  z
    .object({
      body: schema,
      params: z.object({}).passthrough(),
      query: z.object({}).passthrough(),
    })
    .passthrough();
const dashboardSchema = querySchema(
  z
    .object({
      district: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
);
const riskCasesSchema = querySchema(
  z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    risk: z.enum(['all', 'normal', 'moderate', 'high', 'critical']).optional(),
    facility: z.string().trim().optional(),
    follow_up_status: z.enum(['all', 'needs_follow_up', 'scheduled', 'completed', 'overdue']).optional(),
    search: z.string().trim().max(160).optional(),
  }).strict()
);
const screeningAnalyticsSchema = querySchema(
  z.object({
    range: z.enum(['today', '7d', '30d', '90d', 'all', 'custom']).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    hospital_id: z.string().trim().optional(),
    facility_name: z.string().trim().optional(),
    area: z.string().trim().optional(),
    category: z.string().trim().optional(),
    risk: z.enum(['all', 'normal', 'moderate', 'high', 'critical']).optional(),
  }).strict()
);
const appointmentsAnalyticsSchema = querySchema(
  z.object({
    status: z.enum(['all', 'upcoming', 'pending', 'booked', 'confirmed', 'completed', 'cancelled', 'missed', 'rescheduled']).optional(),
    hospital_id: z.string().trim().optional(),
    doctor_id: z.string().trim().optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().max(160).optional(),
  }).strict()
);
const hospitalsListSchema = querySchema(
  z.object({
    search: z.string().trim().max(160).optional(),
    status: z.enum(['all', 'active', 'inactive', 'pending', 'suspended', 'rejected']).optional(),
    type: z.enum(['all', 'hospital', 'chc', 'phc', 'other', 'unverified']).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }).strict()
);
const managersListSchema = querySchema(
  z.object({
    search: z.string().trim().max(160).optional(),
    status: z.enum(['all', 'active', 'inactive', 'pending', 'rejected']).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }).strict()
);
const doctorsListSchema = querySchema(
  z.object({
    search: z.string().trim().max(160).optional(),
    status: z.enum(['all', 'active', 'inactive', 'pending', 'rejected', 'approved']).optional(),
    hospital_id: z.string().trim().optional(),
    specialty: z.string().trim().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }).strict()
);
const patientsListSchema = querySchema(
  z.object({
    search: z.string().trim().max(160).optional(),
    risk: z.enum(['all', 'normal', 'moderate', 'high', 'critical', 'unclassified']).optional(),
    facility: z.string().trim().optional(),
    follow_up: z.enum(['all', 'required', 'scheduled', 'completed', 'none', 'overdue']).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }).strict()
);
const registrationsListSchema = querySchema(
  z.object({
    type: z.enum(['all', 'doctor', 'admin', 'hospital', 'facility']).optional(),
    status: z.enum(['all', 'pending', 'approved', 'rejected']).optional(),
  }).strict()
);
const activitiesSchema = querySchema(
  z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    type: z.string().trim().optional(),
  }).strict()
);
const assignScreeningDoctorSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({ doctor_id: uuid }).strict(),
}).passthrough();
const screeningFollowUpSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    follow_up_date: z.string().date().optional().nullable(),
    follow_up_status: z.enum(['needs_follow_up', 'scheduled', 'completed', 'overdue', 'cancelled']),
    notes: z.string().trim().max(500).optional(),
  }).strict(),
}).passthrough();
const updateAppointmentStatusSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    action: z.enum(['approve', 'reject', 'cancel', 'reschedule', 'complete', 'assign_doctor']),
    doctor_id: uuid.optional(),
    scheduled_at: z.string().datetime().optional(),
    slot: z.string().optional(),
    notes: z.string().trim().max(500).optional(),
  }).strict(),
}).passthrough();
const updateFacilityStatusSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    status: z.enum(['active', 'inactive', 'suspended', 'approved', 'rejected', 'pending_approval']),
    reason: z.string().trim().max(500).optional(),
  }).strict(),
}).passthrough();
const assignFacilityManagerSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    manager_user_id: uuid.nullable(),
  }).strict(),
}).passthrough();
const facilityDirectoryListSchema = querySchema(z.object({ search: z.string().trim().max(160).optional() }).strict());
const facilityDirectoryIdSchema = z.object({ params: z.object({ id: uuid }) }).passthrough();
const facilityDirectoryCreateSchema = bodySchema(z.object({
  name: z.string().trim().min(2).max(160),
  area: z.string().trim().max(120).default(''),
  facility_type: z.enum(['unverified', 'hospital', 'chc', 'phc', 'other']).default('unverified'),
  verification_status: z.enum(['unverified', 'verified']).default('unverified'),
  is_active: z.boolean().default(true),
  manager_user_id: uuid.nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.verification_status === 'verified' && value.facility_type === 'unverified') {
    context.addIssue({ code: 'custom', path: ['facility_type'], message: 'Choose a verified facility type before marking this location verified' });
  }
}));
const facilityDirectoryUpdateSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().trim().min(2).max(160).optional(),
    area: z.string().trim().max(120).optional(),
    facility_type: z.enum(['unverified', 'hospital', 'chc', 'phc', 'other']).optional(),
    verification_status: z.enum(['unverified', 'verified']).optional(),
    is_active: z.boolean().optional(),
    manager_user_id: uuid.nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0).superRefine((value, context) => {
    if (value.verification_status === 'verified' && value.facility_type === 'unverified') {
      context.addIssue({ code: 'custom', path: ['facility_type'], message: 'Choose a verified facility type before marking this location verified' });
    }
  }),
}).passthrough();

const profileSchema = z.object({
  registration_number: z.string().trim().min(1).max(100).optional(),
  qualification: z.string().trim().max(200).optional(),
  worker_code: z.string().trim().min(1).max(100).optional(),
  specialty: z.string().trim().min(1).max(160).optional(),
  facility_name: z.string().trim().max(160).optional(),
  district: z.string().trim().max(100).optional(),
  phc_id: uuid.optional().nullable(),
  hospital_id: uuid.optional().nullable(),
  village_id: uuid.optional().nullable(),
  district: z.string().trim().max(100).optional(),
  mandal: z.string().trim().max(100).optional(),
  availability: availability.optional(),
});

const createUserSchema = bodySchema(
  z
    .object({
      full_name: z.string().trim().min(1).max(160),
      mobile: z.string().regex(/^[6-9]\d{9}$/),
      email: z.string().trim().email().max(254).optional().or(z.literal('')),
      username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
      password,
      confirm_password: z.string().min(1).max(128).optional(),
      role: accountRole,
      admin_id: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
      preferred_language: language,
      profile: profileSchema.default({}),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.role === 'admin') {
        if (!value.email) context.addIssue({ code: 'custom', path: ['email'], message: 'Admin email is required' });
        if (!value.username) context.addIssue({ code: 'custom', path: ['username'], message: 'Admin username is required' });
        if (!value.confirm_password || value.password !== value.confirm_password) {
          context.addIssue({ code: 'custom', path: ['confirm_password'], message: 'Password confirmation does not match' });
        }
      } else if (value.admin_id || value.username || value.confirm_password) {
        context.addIssue({ code: 'custom', path: ['username'], message: 'Admin fields are only valid for admin accounts' });
      }
    }),
);

const listUsersSchema = querySchema(
  z
    .object({
      page: z.string().regex(/^\d+$/).optional(),
      limit: z.string().regex(/^\d+$/).optional(),
      search: z.string().trim().max(160).optional(),
      role: z.string().max(30).optional(),
      status: z.enum(['active', 'inactive', 'pending', 'rejected']).optional(),
      district: z.string().trim().max(100).optional(),
      phc: uuid.optional(),
      hospital: uuid.optional(),
      sort: z.enum(['name', 'role', 'status', 'created_at', 'mobile']).default('created_at'),
      order: z.enum(['asc', 'desc']).default('desc'),
    })
    .strict(),
);

const userIdSchema = z
  .object({
    params: z.object({ id: uuid }),
  })
  .passthrough();

const updateUserSchema = z
  .object({
    body: z
      .object({
        full_name: z.string().trim().min(1).max(160).optional(),
        mobile: z
          .string()
          .regex(/^[6-9]\d{9}$/)
          .optional(),
        email: z.string().trim().email().max(254).nullable().optional(),
        preferred_language: z.enum(['en', 'te', 'hi', 'or']).optional(),
        role: accountRole.optional(),
        is_active: z.boolean().optional(),
        reset_password: z.boolean().optional(),
        profile: profileSchema.optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: 'At least one field must be provided',
      }),
    params: z.object({ id: uuid }),
  })
  .passthrough();

const reviewDoctorRegistrationSchema = z
  .object({
    body: z.object({ decision: z.enum(['approved', 'rejected']) }).strict(),
    params: z.object({ id: uuid }),
  })
  .passthrough();
const reviewAdminRegistrationSchema = z
  .object({
    body: z.object({ decision: z.enum(['approved', 'rejected']) }).strict(),
    params: z.object({ id: uuid }),
  })
  .passthrough();

const reportSchema = querySchema(
  z
    .object({
      type: z.enum([
        'users',
        'patients',
        'appointments',
        'referrals',
        'screenings',
        'emergency',
        'hospitals',
        'risk_cases',
        'doctors',
        'facilities',
        'patient_follow_up',
      ]),
      from: z.string().date().optional(),
      to: z.string().date().optional(),
      format: z.enum(['json', 'csv', 'pdf']).default('json'),
    })
    .strict()
    .refine(({ from, to }) => !from || !to || from <= to, {
      message: 'from must be on or before to',
      path: ['to'],
    }),
);

const auditLogsSchema = querySchema(
  z
    .object({
      page: z.string().regex(/^\d+$/).optional(),
      limit: z.string().regex(/^\d+$/).optional(),
      user: uuid.optional(),
      action: z.string().trim().max(120).optional(),
      resource: z.string().trim().max(80).optional(),
      from: z.string().date().optional(),
      to: z.string().date().optional(),
    })
    .strict()
    .refine(({ from, to }) => !from || !to || from <= to, {
      message: 'from must be on or before to',
      path: ['to'],
    }),
);
const roleNameParams = z.object({
  params: z.object({ name: z.enum(ROLE_NAMES) }),
}).passthrough();
const updateRolePermissionsSchema = z.object({
  body: z.object({
    permissions: z.array(z.enum(ALL_PERMISSIONS)).max(ALL_PERMISSIONS.length),
  }).strict(),
  params: z.object({ name: z.enum(ROLE_NAMES) }),
}).passthrough();

module.exports = {
  dashboardSchema,
  riskCasesSchema,
  screeningAnalyticsSchema,
  appointmentsAnalyticsSchema,
  hospitalsListSchema,
  managersListSchema,
  doctorsListSchema,
  patientsListSchema,
  registrationsListSchema,
  activitiesSchema,
  assignScreeningDoctorSchema,
  screeningFollowUpSchema,
  updateAppointmentStatusSchema,
  updateFacilityStatusSchema,
  assignFacilityManagerSchema,
  facilityDirectoryListSchema,
  facilityDirectoryIdSchema,
  facilityDirectoryCreateSchema,
  facilityDirectoryUpdateSchema,
  createUserSchema,
  listUsersSchema,
  userIdSchema,
  updateUserSchema,
  reviewDoctorRegistrationSchema,
  reviewAdminRegistrationSchema,
  reportSchema,
  auditLogsSchema,
  roleNameParams,
  updateRolePermissionsSchema,
};
