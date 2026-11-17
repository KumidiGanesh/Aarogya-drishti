const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const validators = require('./validators');

function createRouter(paths) {
  const router = express.Router();
  router.use(authenticate);
  paths(router);
  return router;
}

const medicines = createRouter((router) => {
  router.post('/', authorize('patient', 'doctor', 'health_worker'), requirePermission('medicines:manage'), validate(validators.createMedicine), controller.createMedicine);
  router.get('/', authorize('patient', 'doctor', 'health_worker', 'specialist', 'admin', 'super_admin'), requirePermission('medicines:read'), validate(validators.listMedicines), controller.listMedicines);
});
const reminders = createRouter((router) => {
  router.post('/', authorize('patient', 'doctor', 'health_worker'), requirePermission('medicines:manage'), validate(validators.createReminder), controller.createReminder);
  router.get('/', authorize('patient', 'doctor', 'health_worker', 'specialist', 'admin', 'super_admin'), requirePermission('medicines:read'), validate(validators.listReminders), controller.listReminders);
});
const logs = createRouter((router) => {
  router.post('/', authorize('doctor', 'admin', 'super_admin'), requirePermission('medicines:manage'), validate(validators.createLog), controller.createLog);
  router.get('/', authorize('patient', 'doctor', 'health_worker', 'specialist', 'admin', 'super_admin'), requirePermission('medicines:read'), validate(validators.listLogs), controller.listLogs);
});

module.exports = { medicines, reminders, logs };
