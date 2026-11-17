function isTwilioConfigured() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const senderConfigured = process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER;
  return Boolean(accountSid && authToken && senderConfigured);
}

async function sendWithTwilio({ to, message }) {
  if (!isTwilioConfigured()) return { delivered: false, reason: 'provider_not_configured' };

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!/^AC[a-f\d]{32}$/i.test(accountSid)
    || (messagingServiceSid && !/^MG[a-f\d]{32}$/i.test(messagingServiceSid))
    || (!messagingServiceSid && !/^\+[1-9]\d{7,14}$/.test(from || ''))) {
    throw new Error('Twilio SMS configuration is invalid');
  }

  const body = new URLSearchParams({ To: to, Body: message });
  if (messagingServiceSid) body.set('MessagingServiceSid', messagingServiceSid);
  else body.set('From', from);
  const authorization = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) {
    throw new Error(`Twilio SMS provider returned HTTP ${response.status}`);
  }
  return { delivered: true };
}

async function sendSms({ to, message, idempotencyKey }) {
  if (process.env.SMS_PROVIDER === 'twilio') {
    return sendWithTwilio({ to, message });
  }
  if (process.env.SMS_PROVIDER && process.env.SMS_PROVIDER !== 'custom') {
    throw new Error('Unsupported SMS provider');
  }

  const providerUrl = process.env.SMS_PROVIDER_URL;
  const token = process.env.SMS_PROVIDER_TOKEN;
  if (!providerUrl || !token) return { delivered: false, reason: 'provider_not_configured' };
  const response = await fetch(providerUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ to, message }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`SMS provider returned HTTP ${response.status}`);
  }
  return { delivered: true };
}

module.exports = { sendSms };
