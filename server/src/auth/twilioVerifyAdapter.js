const twilio = require('twilio');

const ACCOUNT_SID_PATTERN = /^AC[a-f\d]{32}$/i;
const VERIFY_SERVICE_SID_PATTERN = /^VA[a-f\d]{32}$/i;

function getService() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) return null;
  if (!ACCOUNT_SID_PATTERN.test(accountSid) || !VERIFY_SERVICE_SID_PATTERN.test(serviceSid)) {
    throw new Error('Twilio Verify configuration is invalid');
  }
  return twilio(accountSid, authToken).verify.v2.services(serviceSid);
}

async function sendVerification(to) {
  const service = getService();
  if (!service) return { delivered: false };
  const result = await service.verifications.create({ to, channel: 'sms' });
  return { delivered: ['pending', 'approved'].includes(result.status) };
}

async function checkVerification(to, code) {
  const service = getService();
  if (!service) {
    const error = new Error('Twilio Verify is not configured');
    error.code = 'TWILIO_VERIFY_NOT_CONFIGURED';
    throw error;
  }
  const result = await service.verificationChecks.create({ to, code });
  return { approved: result.status === 'approved' };
}

module.exports = {
  sendVerification,
  checkVerification,
};
