import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const authState = vi.hoisted(() => ({
  loginPatient: vi.fn(),
  user: null,
  loading: false,
}));
const mockApi = vi.hoisted(() => ({ post: vi.fn() }));
let originalClipboardDescriptor;
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));
vi.mock('../services/api.js', () => ({ default: mockApi }));

import i18n from '../i18n/index.js';
import PatientLoginPage from './PatientLoginPage.jsx';

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

describe('patient password login', () => {
  beforeEach(async () => {
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    vi.clearAllMocks();
    authState.user = null;
    authState.loading = false;
    authState.loginPatient.mockResolvedValue({ role: 'patient' });
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

  it('signs in with mobile and password and opens the patient dashboard', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/patient/login']}>
          <Routes>
            <Route path="/patient/login" element={<PatientLoginPage />} />
            <Route path="/patient/dashboard" element={<CurrentPath />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );

    fireEvent.change(screen.getByLabelText('Indian mobile number'), {
      target: { value: '9876543210' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(authState.loginPatient).toHaveBeenCalledWith(
      '9876543210',
      'StrongPass1',
    ));
    expect(await screen.findByTestId('current-path')).toHaveTextContent('/patient/dashboard');
  });

  it('displays and copies the backend-generated demo code for password recovery', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mockApi.post.mockResolvedValueOnce({
      data: { data: {
        challenge_id: 'b'.repeat(36),
        expires_in: 300,
        resend_after: 30,
        delivery_mode: 'demo',
        demo_otp: '819406',
      } },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/patient/login']}>
          <PatientLoginPage />
        </MemoryRouter>
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Forgot Password?' }));
    fireEvent.change(screen.getByLabelText('Indian mobile number', { selector: '#patient-recovery-mobile' }), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));

    expect(await screen.findByText('Your Demo OTP is 819406')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy OTP' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('819406'));
    expect(await screen.findByText('Demo OTP copied.')).toBeInTheDocument();
  });
});
