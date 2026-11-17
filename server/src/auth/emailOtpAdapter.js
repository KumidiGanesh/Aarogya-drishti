function isConfigured() {
  return Boolean(process.env.OTP_EMAIL_PROVIDER_URL && process.env.OTP_EMAIL_PROVIDER_TOKEN);
}

async function sendEmail({ to, code }) {
  const providerUrl = process.env.OTP_EMAIL_PROVIDER_URL;
  const token = process.env.OTP_EMAIL_PROVIDER_TOKEN;
  if (!isConfigured()) return { delivered: false, reason: 'provider_not_configured' };

  const response = await fetch(providerUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to,
      subject: 'Aarogya Drishti verification code',
      text: `Your verification code is ${code}. It expires in 5 minutes.`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
  return { delivered: true };
}

module.exports = { isConfigured, sendEmail };
