const service = require('./service');

function handler(action, successMessage, statusCode = 200) {
  return async (req, res, next) => {
    try {
      const result = await action(req);
      return res.status(statusCode).json({
        success: true,
        message: successMessage,
        data: result.data,
        meta: result.meta || {},
      });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  createMedicine: handler((req) => service.createMedicine(req.validated.body, req.user, req), 'Medicine saved', 201),
  listMedicines: handler((req) => service.listMedicines(req.validated.query, req.user), 'Medicines loaded'),
  createReminder: handler((req) => service.createReminder(req.validated.body, req.user, req), 'Medicine reminder created', 201),
  listReminders: handler((req) => service.listReminders(req.validated.query, req.user), 'Medicine reminders loaded'),
  createLog: handler((req) => service.createLog(req.validated.body, req.user, req), 'Medicine dose recorded'),
  listLogs: handler((req) => service.listLogs(req.validated.query, req.user), 'Medicine logs loaded'),
};
