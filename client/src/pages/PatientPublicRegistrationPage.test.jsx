import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const authState = vi.hoisted(() => ({
  completeRegistration: vi.fn(),
  user: null,
  loading: false,
}));
const mockApi = vi.hoisted(() => ({ post: vi.fn() }));
let originalClipboardDescriptor;
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));
vi.mock('../services/api.js', () => ({ default: mockApi }));

import i18n from '../i18n/index.js';
import PatientPublicRegistrationPage from './PatientPublicRegistrationPage.jsx';

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{`${location.pathname}${location.search}`}</output>;
}

function LoginHandoff() {
  const location = useLocation();
  return (
    <>
      <output data-testid="current-path">{`${location.pathname}${location.search}`}</output>
      <output data-testid="handoff-mobile">{location.state?.mobile}</output>
    </>
  );
}

describe('patient OTP registration', () => {
  beforeEach(async () => {
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    vi.clearAllMocks();
    authState.user = null;
    authState.loading = false;
    authState.completeRegistration.mockResolvedValue({ role: 'patient' });
    mockApi.post.mockImplementation((path) => {
      if (path === '/patient/send-otp') {
        return Promise.resolve({
          data: { data: {
            challenge_id: 'a'.repeat(36),
            expires_in: 300,
            resend_after: 30,
            delivery_mode: 'demo',
            demo_otp: '654321',
          } },
        });
      }
      if (path === '/patient/verify-otp') {
        return Promise.resolve({ data: { data: { verification_token: 'v'.repeat(43) } } });
      }
      return Promise.resolve({
        data: { data: { user: { role: 'patient' }, accessToken: 'access-token' } },
      });
    });
    localStorage.setItem('aarogya-language', 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
    } else {
      delete navigator.clipboard;
    }
  });

  it('creates a patient account only after mobile OTP verification and consent', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/register?type=patient']}>
          <Routes>
            <Route path="/register" element={<PatientPublicRegistrationPage />} />
            <Route path="*" element={<CurrentPath />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByLabelText('Indian mobile number'), {
      target: { value: '+91 98765 43210' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await screen.findByLabelText('Verification code digit 1');
    expect(screen.getByRole('heading', { name: 'Enter OTP' })).toBeInTheDocument();
    expect(screen.getByText('Your Demo OTP is 654321')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy OTP' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('654321'));
    expect(await screen.findByText('Demo OTP copied.')).toBeInTheDocument();
    expect(screen.getByText('Enter the demo verification code for +91 ******3210.')).toBeInTheDocument();
    expect(screen.getByText('DEMO MODE – NOT REAL SMS VERIFICATION')).toBeInTheDocument();
    for (let digit = 1; digit <= 6; digit += 1) {
      expect(screen.getByLabelText(`Verification code digit ${digit}`)).toHaveAttribute('maxlength', '1');
    }
    fireEvent.paste(screen.getByLabelText('Verification code digit 1'), {
      clipboardData: { getData: () => '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify OTP' }));

    await screen.findByLabelText('Full name');
    expect(screen.getByText('Mobile number verified successfully!')).toBeInTheDocument();
    expect(mockApi.post).toHaveBeenNthCalledWith(1, '/patient/send-otp', { mobile: '9876543210' });
    expect(mockApi.post).toHaveBeenNthCalledWith(2, '/patient/verify-otp', {
      challenge_id: 'a'.repeat(36),
      code: '123456',
    });

    const password = screen.getByLabelText('Password');
    const confirmPassword = screen.getByLabelText('Confirm password');
    expect(password).toHaveAttribute('type', 'password');
    expect(confirmPassword).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getAllByRole('button', { name: 'Show password' })[0]);
    expect(password).toHaveAttribute('type', 'text');
    expect(confirmPassword).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(confirmPassword).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide password' })[0]);
    expect(password).toHaveAttribute('type', 'password');
    expect(confirmPassword).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(confirmPassword).toHaveAttribute('type', 'password');

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Demo Patient' } });
    fireEvent.change(screen.getByLabelText('Age'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'demo.patient@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'DemoPass1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'DemoPass1' } });
    fireEvent.change(screen.getByLabelText('Village name'), { target: { value: 'Demo Village' } });
    fireEvent.change(screen.getByLabelText('Mandal'), { target: { value: 'Demo Mandal' } });
    fireEvent.change(screen.getByLabelText('Street address'), { target: { value: 'Demo address' } });
    fireEvent.change(screen.getByLabelText('District'), { target: { value: 'Demo district' } });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Andhra Pradesh' } });
    fireEvent.change(screen.getByLabelText('Emergency contact mobile number'), {
      target: { value: '9876543211' },
    });
    fireEvent.click(screen.getByLabelText('Tobacco use'));
    fireEvent.click(screen.getByLabelText('Gutkha use'));
    fireEvent.click(screen.getByLabelText('I consent to collection and use of my information for healthcare services.'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete registration' }));

    await waitFor(() => expect(mockApi.post).toHaveBeenLastCalledWith('/patient/register', expect.objectContaining({
      verification_token: 'v'.repeat(43),
      full_name: 'Demo Patient',
      mobile: '9876543210',
      age: 30,
      email: 'demo.patient@example.test',
      password: 'DemoPass1',
      confirm_password: 'DemoPass1',
      mandal: 'Demo Mandal',
      medical_history: expect.objectContaining({ tobacco_use: true, gutkha_use: true }),
      consent: true,
    })));
    expect(authState.completeRegistration).toHaveBeenCalledWith({
      user: { role: 'patient' },
      accessToken: 'access-token',
    });
    expect(await screen.findByTestId('current-path')).toHaveTextContent('/patient/dashboard');
  });

  it('shows the required invalid-OTP message for an incorrect code', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/patient/register']}>
          <PatientPublicRegistrationPage />
        </MemoryRouter>
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByLabelText('Indian mobile number'), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await screen.findByLabelText('Verification code digit 1');
    fireEvent.paste(screen.getByLabelText('Verification code digit 1'), {
      clipboardData: { getData: () => '000000' },
    });
    mockApi.post.mockRejectedValueOnce({
      response: { data: { code: 'OTP_INVALID' } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify OTP' }));

    expect(await screen.findByText('Invalid OTP. Please enter the correct verification code.')).toBeInTheDocument();
  });

  it('does not report a missing registration API as an invalid mobile number', async () => {
    mockApi.post.mockRejectedValueOnce({
      response: { status: 404, data: { code: 'NOT_FOUND' } },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/patient/register']}>
          <PatientPublicRegistrationPage />
        </MemoryRouter>
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByLabelText('Indian mobile number'), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));

    expect(await screen.findByText(/The sign-in service encountered a server error/)).toBeInTheDocument();
    expect(screen.queryByText('Enter a valid 10-digit Indian mobile number.')).not.toBeInTheDocument();
  });

  it('sends an already registered mobile to OTP sign-in without requesting patient details', async () => {
    mockApi.post.mockRejectedValueOnce({
      response: { status: 409, data: { code: 'MOBILE_ALREADY_REGISTERED' } },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/patient/register']}>
          <Routes>
            <Route path="/patient/register" element={<PatientPublicRegistrationPage />} />
            <Route path="/login" element={<LoginHandoff />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByLabelText('Indian mobile number'), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));

    expect(await screen.findByTestId('current-path')).toHaveTextContent('/login?type=patient');
    expect(screen.getByTestId('handoff-mobile')).toHaveTextContent('9876543210');
    expect(mockApi.post).toHaveBeenCalledWith('/patient/send-otp', { mobile: '9876543210' });
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
  });

  it('takes an already registered patient to patient OTP sign-in', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/register?type=patient']}>
          <Routes>
            <Route path="/register" element={<PatientPublicRegistrationPage />} />
            <Route path="*" element={<CurrentPath />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/patient/login');
  });

  it('prefills the mobile number handed off from patient login', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter
          initialEntries={[{
            pathname: '/patient/register',
            state: { mobile: '9876543210' },
          }]}
        >
          <PatientPublicRegistrationPage />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByLabelText('Indian mobile number')).toHaveValue('9876543210');
  });

  it('lets the patient edit the mobile number before registration', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/register?type=patient']}>
          <Routes>
            <Route path="/register" element={<PatientPublicRegistrationPage />} />
            <Route path="*" element={<CurrentPath />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByLabelText('Indian mobile number'), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await screen.findByLabelText('Verification code digit 1');
    fireEvent.click(screen.getByRole('button', { name: 'Edit mobile number' }));

    expect(screen.getByLabelText('Indian mobile number')).toHaveValue('');
    expect(screen.queryByLabelText('Verification code digit 1')).not.toBeInTheDocument();
  });

  it('enables resend after the 30-second cooldown', async () => {
    vi.useFakeTimers();
    let unmount;
    try {
      ({ unmount } = render(
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/register?type=patient']}>
            <Routes>
              <Route path="/register" element={<PatientPublicRegistrationPage />} />
              <Route path="*" element={<CurrentPath />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>,
      ));
      fireEvent.change(screen.getByLabelText('Indian mobile number'), {
        target: { value: '9876543210' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
        await Promise.resolve();
      });
      const resend = screen.getByRole('button', { name: 'Resend OTP (0:30)' });
      expect(resend).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(screen.getByRole('button', { name: 'Resend OTP' })).toBeEnabled();
    } finally {
      unmount?.();
      vi.useRealTimers();
    }
  });
});
