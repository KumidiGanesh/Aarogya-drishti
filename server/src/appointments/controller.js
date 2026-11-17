const service = require('./service');

async function create(req, res, next) {
  try {
    const appointment = await service.createAppointment(req.validated.body, req.user, req);
    return res.status(201).json({
      success: true,
      message: 'Appointment request submitted',
      data: { appointment },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const result = await service.listAppointments(req.validated.query, req.user);
    return res.status(200).json({
      success: true,
      message: 'Appointments loaded',
      data: result.directory
        ? { items: result.items, directory: result.directory }
        : result.preferences
          ? { preferences: result.preferences }
          : { items: result.items, available_slots: result.available_slots },
      meta: result.meta,
    });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const result = await service.updateAppointment(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req,
    );
    return res.status(200).json({
      success: true,
      message: req.validated.body.action === 'reminder_preferences'
        ? 'Reminder preferences saved'
        : req.validated.body.action === 'confirm'
          ? 'Appointment confirmed'
        : 'Appointment updated',
      data: result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    const appointment = await service.deleteAppointment(req.validated.params.id, req.user, req);
    return res.status(200).json({
      success: true,
      message: 'Appointment cancelled',
      data: { appointment },
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, update, remove };
