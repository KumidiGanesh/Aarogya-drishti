const adminService = require('./service');

function paginationFrom(req) {
  const page = Number(req.validated.query.page || 1);
  const limit = Number(req.validated.query.limit || 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    const error = new Error('page must be positive and limit must be between 1 and 100');
    error.status = 400;
    error.code = 'INVALID_PAGINATION';
    throw error;
  }
  return { page, limit, offset: (page - 1) * limit };
}

function sendError(next, error) {
  return next(error);
}

async function dashboard(req, res, next) {
  try {
    const data = await adminService.dashboard(req.validated.query, req.user.role);
    return res.status(200).json({ success: true, message: 'Dashboard loaded', data, meta: {} });
  } catch (error) {
    return sendError(next, error);
  }

}

async function riskCases(req, res, next) {
  try {
    const result = await adminService.listRiskCases(req.validated.query, req.user.role);
    return res.status(200).json({ success: true, message: 'Risk cases loaded', data: { items: result.items, distribution: result.distribution }, meta: result.meta });
  } catch (error) { return sendError(next, error); }
}

async function screeningAnalytics(req, res, next) {
  try {
    const data = await adminService.screeningAnalytics(req.validated.query);
    return res.status(200).json({ success: true, message: 'Screening analytics loaded', data, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function appointmentManagement(req, res, next) {
  try {
    const data = await adminService.appointmentManagement(req.validated.query);
    return res.status(200).json({ success: true, message: 'Appointments loaded', data: { items: data.items, metrics: data.metrics }, meta: data.meta });
  } catch (error) { return sendError(next, error); }
}

async function listHospitals(req, res, next) {
  try {
    const data = await adminService.listHospitals(req.validated.query);
    return res.status(200).json({ success: true, message: 'Hospitals loaded', data: { items: data.items, metrics: data.metrics }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function updateFacilityStatus(req, res, next) {
  try {
    const item = await adminService.updateFacilityStatus(req.validated.params.id, req.validated.body, req);
    return res.status(200).json({ success: true, message: 'Facility status updated', data: { item }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function assignFacilityManager(req, res, next) {
  try {
    const item = await adminService.assignFacilityManager(req.validated.params.id, req.validated.body, req);
    return res.status(200).json({ success: true, message: 'Facility manager assigned', data: { item }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function listManagers(req, res, next) {
  try {
    const data = await adminService.listManagers(req.validated.query);
    return res.status(200).json({ success: true, message: 'Hospital managers loaded', data: { items: data.items, metrics: data.metrics }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function listDoctors(req, res, next) {
  try {
    const data = await adminService.listDoctors(req.validated.query);
    return res.status(200).json({ success: true, message: 'Doctors loaded', data: { items: data.items, metrics: data.metrics }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function listPatients(req, res, next) {
  try {
    const data = await adminService.listPatients(req.validated.query, req.user.role);
    return res.status(200).json({ success: true, message: 'Patients loaded', data: { items: data.items, metrics: data.metrics }, meta: data.meta });
  } catch (error) { return sendError(next, error); }
}

async function listRegistrations(req, res, next) {
  try {
    const data = await adminService.listRegistrations(req.validated.query);
    return res.status(200).json({ success: true, message: 'Registrations loaded', data, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function listActivities(req, res, next) {
  try {
    const data = await adminService.listActivities(req.validated.query);
    return res.status(200).json({ success: true, message: 'Recent activities loaded', data, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function assignScreeningDoctor(req, res, next) {
  try {
    const item = await adminService.assignScreeningDoctor(req.validated.params.id, req.validated.body, req);
    return res.status(200).json({ success: true, message: 'Doctor assigned to screening', data: { item }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function updateScreeningFollowUp(req, res, next) {
  try {
    const item = await adminService.updateScreeningFollowUp(req.validated.params.id, req.validated.body, req);
    return res.status(200).json({ success: true, message: 'Screening follow-up updated', data: { item }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function updateAppointmentStatus(req, res, next) {
  try {
    const item = await adminService.updateAppointmentStatus(req.validated.params.id, req.validated.body, req);
    return res.status(200).json({ success: true, message: 'Appointment status updated', data: { item }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function listFacilityDirectory(req, res, next) {
  try {
    const items = await adminService.listFacilityDirectory(req.validated.query.search || '');
    return res.status(200).json({ success: true, message: 'Facility locations loaded', data: { items }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function createFacilityDirectoryEntry(req, res, next) {
  try {
    const item = await adminService.createFacilityDirectoryEntry(req.validated.body, req);
    return res.status(201).json({ success: true, message: 'Facility location created', data: { item }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function updateFacilityDirectoryEntry(req, res, next) {
  try {
    const item = await adminService.updateFacilityDirectoryEntry(req.validated.params.id, req.validated.body, req);
    return res.status(200).json({ success: true, message: 'Facility location updated', data: { item }, meta: {} });
  } catch (error) { return sendError(next, error); }
}

async function listRoles(req, res, next) {
  try {
    const data = await adminService.listRoles();
    return res.status(200).json({ success: true, message: 'Roles loaded', data, meta: {} });
  } catch (error) {
    return sendError(next, error);
  }
}

async function updateRolePermissions(req, res, next) {
  try {
    const role = await adminService.updateRolePermissions(
      req.validated.params.name,
      req.validated.body.permissions,
      req,
    );
    return res.status(200).json({
      success: true,
      message: 'Role permissions updated',
      data: { role },
      meta: {},
    });
  } catch (error) {
    return sendError(next, error);
  }
}

async function createUser(req, res, next) {
  try {
    const data = await adminService.createUser(req.validated.body, req);
    return res.status(201).json({ success: true, message: 'User created', data, meta: {} });
  } catch (error) {
    return sendError(next, error);
  }
}

async function listUsers(req, res, next) {
  try {
    const result = await adminService.listUsers(req.validated.query, paginationFrom(req));
    return res.status(200).json({
      success: true,
      message: 'Users loaded',
      data: { items: result.items },
      meta: result.meta,
    });
  } catch (error) {
    return sendError(next, error);
  }
}

async function getUser(req, res, next) {
  try {
    const data = await adminService.getUser(req.validated.params.id);
    return res.status(200).json({ success: true, message: 'User loaded', data, meta: {} });
  } catch (error) {
    return sendError(next, error);
  }
}

async function updateUser(req, res, next) {
  try {
    const data = await adminService.updateUser(req.validated.params.id, req.validated.body, req);
    return res.status(200).json({ success: true, message: 'User updated', data, meta: {} });
  } catch (error) {
    return sendError(next, error);
  }
}

async function reviewDoctorRegistration(req, res, next) {
  try {
    const user = await adminService.reviewDoctorRegistration(
      req.validated.params.id,
      req.validated.body.decision,
      req,
    );
    return res.status(200).json({
      success: true,
      message: `Doctor registration ${req.validated.body.decision}`,
      data: { user },
      meta: {},
    });
  } catch (error) {
    return sendError(next, error);
  }
}

async function reviewAdminRegistration(req, res, next) {
  try {
    const user = await adminService.reviewAdminRegistration(
      req.validated.params.id,
      req.validated.body.decision,
      req,
    );
    return res.status(200).json({
      success: true,
      message: `Administrator registration ${req.validated.body.decision}`,
      data: { user },
      meta: {},
    });
  } catch (error) {
    return sendError(next, error);
  }
}

async function deleteUser(req, res, next) {
  try {
    await adminService.deleteUser(req.validated.params.id, req);
    return res.status(204).end();
  } catch (error) {
    return sendError(next, error);
  }
}

async function report(req, res, next) {
  try {
    const result = await adminService.report(req.validated.query, req);
    if (result.format === 'json') {
      return res.status(200).json({
        success: true,
        message: 'Report generated',
        data: { items: result.content },
        meta: { total: result.content.length, truncated: result.content.length === 5000 },
      });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader(
      'Content-Type',
      result.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
    );
    return res.status(200).send(result.content);
  } catch (error) {
    return sendError(next, error);
  }
}

async function auditLogs(req, res, next) {
  try {
    const result = await adminService.listAuditLogs(
      req.validated.query,
      paginationFrom(req),
      req.user.role,
    );
    return res.status(200).json({
      success: true,
      message: 'Audit logs loaded',
      data: { items: result.items },
      meta: result.meta,
    });
  } catch (error) {
    return sendError(next, error);
  }
}

module.exports = {
  dashboard,
  riskCases,
  screeningAnalytics,
  appointmentManagement,
  listHospitals,
  updateFacilityStatus,
  assignFacilityManager,
  listManagers,
  listDoctors,
  listPatients,
  listRegistrations,
  listActivities,
  assignScreeningDoctor,
  updateScreeningFollowUp,
  updateAppointmentStatus,
  listFacilityDirectory,
  createFacilityDirectoryEntry,
  updateFacilityDirectoryEntry,
  listRoles,
  updateRolePermissions,
  createUser,
  listUsers,
  getUser,
  updateUser,
  reviewDoctorRegistration,
  reviewAdminRegistration,
  deleteUser,
  report,
  auditLogs,
};
