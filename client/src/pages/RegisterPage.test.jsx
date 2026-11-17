import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';

const authState = vi.hoisted(() => ({
  register: vi.fn(),
  user: null,
  loading: false,
}));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));

import i18n from '../i18n/index.js';
import RegisterPage from './RegisterPage.jsx';

describe('doctor registration form', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    authState.user = null;
    authState.loading = false;
    authState.register.mockResolvedValue({ account_status: 'pending_approval' });
    localStorage.setItem('aarogya-language', 'en');
    await i18n.changeLanguage('en');
  });

  it('submits the doctor request without email OTP and keeps administrator approval', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/register?type=doctor']}>
          <RegisterPage />
        </MemoryRouter>
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Demo Doctor' } });
    fireEvent.change(screen.getByLabelText('Indian mobile number'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'doctor@example.test' } });
    fireEvent.change(screen.getByLabelText('Medical registration number'), { target: { value: 'DEMO-REG-123' } });
    fireEvent.change(screen.getByLabelText('Specialization'), { target: { value: 'Oral health' } });
    fireEvent.change(screen.getByLabelText('Hospital / PHC name'), { target: { value: 'Demo PHC' } });
    fireEvent.change(screen.getByLabelText('District'), { target: { value: 'Demo district' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'DemoPassword1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'DemoPassword1' } });

    expect(screen.queryByRole('button', { name: 'Verify email address' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit doctor request' }));

    await waitFor(() => {
      expect(authState.register).toHaveBeenCalledWith(expect.objectContaining({
        account_type: 'doctor',
        email: 'doctor@example.test',
        registration_number: 'DEMO-REG-123',
        specialty: 'Oral health',
        facility_name: 'Demo PHC',
        district: 'Demo district',
      }));
    });
    expect(authState.register.mock.calls[0][0]).not.toHaveProperty('email_verification_token');
    expect(await screen.findByText(
      'Your request was submitted. You can sign in after an administrator approves your account.',
    )).toBeInTheDocument();
  });
});
