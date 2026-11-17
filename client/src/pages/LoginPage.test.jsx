import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

const authState = vi.hoisted(() => ({
  login: vi.fn(),
  loginWithOtp: vi.fn(),
  user: null,
  loading: false,
}));
const mockApi = vi.hoisted(() => ({ post: vi.fn() }));
let originalClipboardDescriptor;
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));
vi.mock('../services/api.js', () => ({ default: mockApi }));

import i18n from '../i18n/index.js';
import LoginPage from './LoginPage.jsx';

function CurrentPath() {
  const location = useLocation();
  return (
    <output data-testid="current-path">
      {location.pathname}
      {location.state?.mobile ? `?mobile=${location.state.mobile}` : ''}
    </output>
  );
}

describe('role-based login selection', () => {
  beforeEach(async () => {
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    vi.clearAllMocks();
    authState.user = null;
    authState.loading = false;
    mockApi.post.mockReset();
    mockApi.post.mockResolvedValue({
      data: { data: { challenge_id: 'a'.repeat(36), expires_in: 300, resend_after: 30 } },
    });
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
    } else {
      delete navigator.clipboard;
    }
  });

  function renderLoginPage(initialEntry = '/login') {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/patient/verify-otp" element={<LoginPage />} />
            <Route path="/patient/login" element={<Navigate replace to="/login?type=patient" />} />
            <Route path="/patient/register" element={<CurrentPath />} />
            <Route path="*" element={<CurrentPath />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );
  }
it('offers patient OTP, doctor, and admin sign-in options', () => {
  renderLoginPage();

  expect(screen.getByRole('heading', { name: 'Connected Care for Every Community' })).toBeInTheDocument();
  expect(screen.getByText('A secure workspace for oral health teams across ITDA Paderu.')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Choose your sign-in type' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Patient Login' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Doctor Login' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Admin Login' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'New patient? Register here' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Request access' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Request a doctor account' })).toHaveAttribute(
    'href',
    '/register?type=doctor',
  );
  expect(screen.getByLabelText('Registered email address')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Forgot Password?' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Create Admin Account' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Doctor Login' }));
  expect(screen.getByText('Sign in with your registered email and password.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Doctor Login' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Admin Login' }));
  expect(screen.getByRole('heading', { name: 'Admin Login' })).toBeInTheDocument();
  expect(screen.getByText('Restricted to authorized administrators.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Create Admin Account' })).toHaveAttribute(
    'href',
    '/admin-registration',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Forgot Password?' }));
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Enter your registered admin email. We will send a verification code if the account is active.',
  );
  expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Patient Login' }));
  expect(screen.getByLabelText('Indian mobile number')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'New patient? Register here' })).toHaveAttribute(
    'href',
    '/patient/register',
  );
});

it('opens patient OTP login when the registration page links back to sign in', () => {
  renderLoginPage('/login?type=patient');

  expect(screen.getByRole('button', { name: 'Patient Login' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Indian mobile number')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send OTP' })).toBeDisabled();
});

it('prefills the registered mobile sent from patient registration for OTP sign-in', () => {
  renderLoginPage({
    pathname: '/login',
    search: '?type=patient',
    state: { mobile: '9876543210' },
  });

  expect(screen.getByLabelText('Indian mobile number')).toHaveValue('9876543210');
  expect(screen.getByRole('button', { name: 'Send OTP' })).toBeEnabled();
});

it('shows a verification-code rate-limit message for patient OTP requests', async () => {
  mockApi.post.mockRejectedValue({
    response: { data: { code: 'OTP_RATE_LIMITED' }, status: 429 },
  });
  renderLoginPage('/login?type=patient');
  fireEvent.change(screen.getByLabelText('Indian mobile number'), {
    target: { value: '9876543210' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Too many verification codes were requested. Please wait 15 minutes before trying again.',
  );
});

it('explains when a registered patient account needs clinic verification', async () => {
  mockApi.post.mockRejectedValue({
    response: { status: 409, data: { code: 'PATIENT_ACCOUNT_UNAVAILABLE' } },
  });
  renderLoginPage('/login?type=patient');
  fireEvent.change(screen.getByLabelText('Indian mobile number'), {
    target: { value: '9876543210' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This number is linked to an inactive or non-patient account. Contact your clinic to verify it before trying again.',
  );
});

it('tells patients with deactivated accounts to request administrator reactivation', async () => {
  mockApi.post.mockRejectedValue({
    response: { status: 409, data: { code: 'PATIENT_ACCOUNT_INACTIVE' } },
  });
  renderLoginPage('/login?type=patient');
  fireEvent.change(screen.getByLabelText('Indian mobile number'), {
    target: { value: '9876543210' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This patient account is inactive. Ask an administrator at your clinic to reactivate it before requesting a code.',
  );
  expect(screen.queryByTestId('current-path')).toBeNull();
});

it('sends an unregistered patient to registration with their mobile number', async () => {
  mockApi.post.mockRejectedValue({
    response: { status: 404, data: { code: 'MOBILE_NOT_REGISTERED' } },
  });
  renderLoginPage('/login?type=patient');
  fireEvent.change(screen.getByLabelText('Indian mobile number'), {
    target: { value: '9876543210' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));

  expect(await screen.findByTestId('current-path')).toHaveTextContent(
    '/patient/register?mobile=9876543210',
  );
});

it('explains when Twilio Verify is temporarily unavailable', async () => {
  authState.loginWithOtp.mockRejectedValue({
    response: { status: 503, data: { code: 'OTP_PROVIDER_UNAVAILABLE' } },
  });
  renderLoginPage('/login?type=patient');
  fireEvent.change(screen.getByLabelText('Indian mobile number'), {
    target: { value: '9876543210' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
  fireEvent.paste(await screen.findByLabelText('Verification code digit 1'), {
    clipboardData: { getData: () => '123456' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Verify OTP' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The SMS verification service is temporarily unavailable. Please try again in a moment.',
  );
});

it('opens the Super Admin registration access page from the Admin Login option', () => {
  renderLoginPage();
  fireEvent.click(screen.getByRole('button', { name: 'Admin Login' }));
  fireEvent.click(screen.getByRole('link', { name: 'Create Admin Account' }));

  expect(screen.getByTestId('current-path')).toHaveTextContent('/admin-registration');
});

it('returns a Super Admin to protected admin registration after using its login link', async () => {
  authState.login.mockResolvedValue({
    role: 'super_admin',
    permissions: ['users:manage'],
  });
  renderLoginPage({
    pathname: '/login',
    state: { from: { pathname: '/admin-registration' } },
  });
  expect(screen.getByRole('button', { name: 'Admin Login' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('link', { name: 'Create Admin Account' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Username / Email'), {
    target: { value: 'superadmin@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'SafePass1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByTestId('current-path')).toHaveTextContent('/admin-registration');
});

it('returns authorized staff to the Language Assistant requested before login', async () => {
  authState.login.mockResolvedValue({
    role: 'doctor',
    permissions: ['languages:use'],
  });
  renderLoginPage({
    pathname: '/login',
    state: { from: { pathname: '/language-assistant' } },
  });
  fireEvent.change(screen.getByLabelText('Registered email address'), {
    target: { value: 'doctor@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'SafePass1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByTestId('current-path')).toHaveTextContent('/language-assistant');
});

it('verifies admin recovery OTP before allowing a password reset', async () => {
  mockApi.post
    .mockResolvedValueOnce({
      data: { data: { challenge_id: 'a'.repeat(36), expires_in: 300, resend_after: 30 } },
    })
    .mockResolvedValueOnce({
      data: { data: { verification_token: 'v'.repeat(43) } },
    })
    .mockResolvedValueOnce({ data: { success: true } });
  renderLoginPage();
  fireEvent.click(screen.getByRole('button', { name: 'Admin Login' }));
  fireEvent.click(screen.getByRole('button', { name: 'Forgot Password?' }));
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'admin@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));

  expect(await screen.findByText('Enter the verification code sent to admin@example.test.')).toBeInTheDocument();
  fireEvent.paste(screen.getByLabelText('Verification code digit 1'), {
    clipboardData: { getData: () => '123456' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Verify OTP' }));
  await vi.waitFor(() => {
    expect(mockApi.post).toHaveBeenLastCalledWith('/auth/otp/verify', {
      challenge_id: 'a'.repeat(36),
      code: '123456',
      purpose: 'admin_password_reset',
    });
  });
  fireEvent.change(await screen.findByLabelText('New password'), {
    target: { value: 'NewStrongPass2' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'NewStrongPass2' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  await vi.waitFor(() => {
    expect(mockApi.post).toHaveBeenLastCalledWith('/auth/password-reset', {
      email: 'admin@example.test',
      verification_token: 'v'.repeat(43),
      password: 'NewStrongPass2',
      confirm: 'NewStrongPass2',
    });
  });
  expect(await screen.findByText('Your password has been reset. You can now sign in.')).toBeInTheDocument();
});

it('sends the selected account category to the server and redirects admins to their dashboard', async () => {
    authState.login.mockResolvedValue({ role: 'admin' });
    renderLoginPage();

    fireEvent.click(screen.getByRole('button', { name: 'Admin Login' }));
    fireEvent.change(screen.getByLabelText('Username / Email'), {
      target: { value: 'admin@demo.example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'SafePass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await vi.waitFor(() => {
      expect(authState.login).toHaveBeenCalledWith(
        'admin@demo.example.test',
        'SafePass1',
        'admin',
      );
    });
    expect(await screen.findByTestId('current-path')).toHaveTextContent('/admin');
  });

  it('sends an authenticated doctor to the doctor dashboard', async () => {
    authState.login.mockResolvedValue({ role: 'doctor' });
    renderLoginPage();
    fireEvent.change(screen.getByLabelText('Registered email address'), {
      target: { value: 'doctor@demo.example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'SafePass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByTestId('current-path')).toHaveTextContent('/doctor');
  });

  it('requests a patient OTP, supports editing and resend cooldown, then redirects after verification', async () => {
    authState.loginWithOtp.mockResolvedValue({ role: 'patient' });
    renderLoginPage();
    fireEvent.click(screen.getByRole('button', { name: 'Patient Login' }));
    fireEvent.change(screen.getByLabelText('Indian mobile number'), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await vi.waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/auth/send-otp', {
        mobile: '9876543210',
      });
    });
    expect(await screen.findByText('We sent a six-digit code to +91 ******3210.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend OTP (0:30)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit mobile number' }));
    expect(screen.getByLabelText('Indian mobile number')).toHaveValue('9876543210');
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    fireEvent.paste(await screen.findByLabelText('Verification code digit 1'), {
      clipboardData: { getData: () => '123456' },
    });
    expect(screen.queryByText(/Development-only OTP/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify OTP' }));
    await vi.waitFor(() => {
      expect(authState.loginWithOtp).toHaveBeenCalledWith(
        'a'.repeat(36),
        '123456',
      );
    });
    expect(await screen.findByTestId('current-path')).toHaveTextContent('/patient/dashboard');
  });

  it('shows and copies the exact development-only demo code returned by the backend', async () => {
    authState.loginWithOtp.mockResolvedValue({ role: 'patient' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mockApi.post.mockResolvedValueOnce({
      data: {
        data: {
          challenge_id: 'a'.repeat(36),
          expires_in: 300,
          resend_after: 30,
          delivery_mode: 'demo',
          demo_otp: '704192',
        },
      },
    });
    renderLoginPage('/login?type=patient');
    fireEvent.change(screen.getByLabelText('Indian mobile number'), {
      target: { value: '+91 98765 43210' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));

    expect(await screen.findByText('DEMO MODE – NOT REAL SMS VERIFICATION')).toBeInTheDocument();
    expect(screen.getByText('Your Demo OTP is 704192')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy OTP' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('704192'));
    expect(await screen.findByText('Demo OTP copied.')).toBeInTheDocument();
    expect(mockApi.post).toHaveBeenCalledWith('/auth/send-otp', { mobile: '9876543210' });
    fireEvent.paste(screen.getByLabelText('Verification code digit 1'), {
      clipboardData: { getData: () => '704192' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify OTP' }));
    await vi.waitFor(() => {
      expect(authState.loginWithOtp).toHaveBeenCalledWith('a'.repeat(36), '704192');
    });
    expect(await screen.findByTestId('current-path')).toHaveTextContent('/patient/dashboard');
  });

  it('shows distinct backend, database, and OTP delivery errors', async () => {
    const cases = [
      [{ request: {} }, 'Cannot reach the sign-in service.'],
      [{ response: { status: 503, data: { code: 'DATABASE_UNAVAILABLE' } } }, 'cannot reach its database'],
      [{ response: { status: 502, data: { code: 'OTP_DELIVERY_FAILED' } } }, 'SMS delivery is not configured'],
    ];

    for (const [failure, message] of cases) {
      mockApi.post.mockRejectedValueOnce(failure);
      const { unmount } = renderLoginPage('/login?type=patient');
      fireEvent.change(screen.getByLabelText('Indian mobile number'), {
        target: { value: '9876543210' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      unmount();
    }
  });

  it('explains when the backend cannot be reached instead of reporting invalid credentials', async () => {
    authState.login.mockRejectedValue({ request: {} });
    renderLoginPage();
    fireEvent.change(screen.getByLabelText('Registered email address'), {
      target: { value: 'doctor@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'SafePass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot reach the sign-in service. Check that the backend is running, then try again.',
    );
  });

  it('shows when a doctor account is awaiting administrator approval', async () => {
    authState.login.mockRejectedValue({
      response: { status: 403, data: { code: 'DOCTOR_APPROVAL_PENDING' } },
    });
    renderLoginPage();
    fireEvent.change(screen.getByLabelText('Registered email address'), {
      target: { value: 'doctor@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your doctor registration request is awaiting administrator approval.',
    );
  });
});
