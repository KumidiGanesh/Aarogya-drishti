const { sendSms } = require('../src/emergency/smsAdapter');

const originalEnvironment = Object.fromEntries([
  'SMS_PROVIDER',
  'SMS_PROVIDER_URL',
  'SMS_PROVIDER_TOKEN',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_MESSAGING_SERVICE_SID',
  'TWILIO_FROM_NUMBER',
].map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  global.fetch = originalFetch;
});

describe('Twilio SMS adapter', () => {
  it('sends the OTP to the exact recipient using server-side credentials', async () => {
    process.env.SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`;
    process.env.TWILIO_AUTH_TOKEN = 'test-secret-token';
    process.env.TWILIO_MESSAGING_SERVICE_SID = `MG${'b'.repeat(32)}`;
    delete process.env.TWILIO_FROM_NUMBER;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201 });

    await expect(sendSms({
      to: '+919876543210',
      message: 'Your verification code is 123456.',
      idempotencyKey: 'challenge-id',
    })).resolves.toEqual({ delivered: true });

    const [url, options] = global.fetch.mock.calls[0];
    const body = new URLSearchParams(options.body);
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:test-secret-token`).toString('base64')}`,
    );
    expect(body.get('To')).toBe('+919876543210');
    expect(body.get('MessagingServiceSid')).toBe(process.env.TWILIO_MESSAGING_SERVICE_SID);
    expect(body.get('Body')).toContain('123456');
  });

  it('fails closed when Twilio credentials are missing', async () => {
    process.env.SMS_PROVIDER = 'twilio';
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    delete process.env.TWILIO_FROM_NUMBER;
    global.fetch = jest.fn();

    await expect(sendSms({
      to: '+919876543210',
      message: 'verification code',
      idempotencyKey: 'challenge-id',
    })).resolves.toEqual({ delivered: false, reason: 'provider_not_configured' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
