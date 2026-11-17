const mockVerifyService = {
  verifications: { create: jest.fn() },
  verificationChecks: { create: jest.fn() },
};
const mockTwilioClient = {
  verify: {
    v2: {
      services: jest.fn(() => mockVerifyService),
    },
  },
};
jest.mock('twilio', () => jest.fn(() => mockTwilioClient));

const twilio = require('twilio');
const adapter = require('../src/auth/twilioVerifyAdapter');

describe('Twilio Verify adapter', () => {
  const originalEnvironment = {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    serviceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
  };

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`;
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.TWILIO_VERIFY_SERVICE_SID = `VA${'b'.repeat(32)}`;
    mockVerifyService.verifications.create.mockReset().mockResolvedValue({ status: 'pending' });
    mockVerifyService.verificationChecks.create.mockReset().mockResolvedValue({ status: 'approved' });
    mockTwilioClient.verify.v2.services.mockClear();
    twilio.mockClear();
  });

  afterAll(() => {
    if (originalEnvironment.accountSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = originalEnvironment.accountSid;
    if (originalEnvironment.authToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = originalEnvironment.authToken;
    if (originalEnvironment.serviceSid === undefined) delete process.env.TWILIO_VERIFY_SERVICE_SID;
    else process.env.TWILIO_VERIFY_SERVICE_SID = originalEnvironment.serviceSid;
  });

  it('sends an SMS verification through the configured Verify service', async () => {
    await expect(adapter.sendVerification('+919876543210')).resolves.toEqual({ delivered: true });

    expect(twilio).toHaveBeenCalledWith(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    );
    expect(mockTwilioClient.verify.v2.services).toHaveBeenCalledWith(
      process.env.TWILIO_VERIFY_SERVICE_SID,
    );
    expect(mockVerifyService.verifications.create).toHaveBeenCalledWith({
      to: '+919876543210',
      channel: 'sms',
    });
  });

  it('checks an SMS code using the configured Verify service', async () => {
    await expect(adapter.checkVerification('+919876543210', '123456')).resolves.toEqual({
      approved: true,
    });
    expect(mockVerifyService.verificationChecks.create).toHaveBeenCalledWith({
      to: '+919876543210',
      code: '123456',
    });
  });

  it('reports missing provider configuration without attempting SMS delivery', async () => {
    delete process.env.TWILIO_VERIFY_SERVICE_SID;

    await expect(adapter.sendVerification('+919876543210')).resolves.toEqual({ delivered: false });
    expect(twilio).not.toHaveBeenCalled();
  });
});
