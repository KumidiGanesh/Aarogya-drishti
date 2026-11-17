const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const controller = require('./controller');
const validators = require('./validators');

const router = express.Router();
router.use(authenticate);
router.post('/sos', authorize('patient', 'health_worker'), requirePermission('emergency:use'), validate(validators.createSos), controller.sendSos);
router.get('/contacts', authorize('patient', 'health_worker', 'admin', 'super_admin'), requirePermission('emergency:use'), validate(validators.getContacts), controller.getContacts);
router.post('/contacts', authorize('patient', 'health_worker'), requirePermission('emergency:use'), validate(validators.createContact), controller.addContact);
router.get('/nearby-hospitals', authorize('patient', 'health_worker', 'doctor', 'specialist', 'admin', 'super_admin'), requirePermission('emergency:use'), validate(validators.nearbyHospitals), controller.nearbyHospitals);

module.exports = router;
