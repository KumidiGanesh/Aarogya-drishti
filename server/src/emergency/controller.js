const service = require('./service');

function handler(action, message, status = 200) {
  return async (req, res, next) => {
    try {
      const result = await action(req);
      return res.status(status).json({
        success: true,
        message,
        data: result.data,
        meta: result.meta || {},
      });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  sendSos: handler((req) => service.sendSos(req.validated.body, req.user, req), 'Emergency request recorded', 201),
  getContacts: handler((req) => service.getContacts(req.validated.query, req.user), 'Emergency contacts loaded'),
  addContact: handler((req) => service.addContact(req.validated.body, req.user, req), 'Emergency contact added', 201),
  nearbyHospitals: handler((req) => service.nearbyHospitals(req.validated.query, req.user), 'Nearby hospitals loaded'),
};
