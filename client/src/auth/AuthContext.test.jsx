import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../services/api.js', () => ({ default: apiMock }));

import { AuthProvider, useAuth } from './AuthContext.jsx';
import i18n from '../i18n.js';

const sessionFor = (preferred_language) => ({
  data: { data: { accessToken: 'test-access-token', user: {
    id: 'doctor-id', role: 'doctor', full_name: 'Asha Rao', preferred_language, permissions: [],
  } } },
});

function AuthProbe() {
  const { user, login, loginWithOtp, logout } = useAuth();
  return <div>
    <output data-testid="auth-language">{user?.preferred_language || 'signed-out'}</output>
    <button onClick={() => login('doctor@example.test', 'not-a-real-password')} type="button">Sign in again</button>
    <button onClick={() => loginWithOtp('challenge-id', '123456')} type="button">Sign in with OTP</button>
    <button onClick={() => logout()} type="button">Sign out</button>
  </div>;
}

describe('language persistence across sessions', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');
    localStorage.removeItem('aarogya-language');
    apiMock.get.mockReset();
    apiMock.put.mockReset().mockResolvedValue({ data: { success: true } });
    apiMock.post.mockReset();
    apiMock.post.mockImplementation((path) => {
      if (path === '/auth/refresh-token') return Promise.resolve(sessionFor('te'));
      if (path === '/auth/logout') return Promise.resolve({ data: { success: true } });
      if (path === '/auth/login') return Promise.resolve(sessionFor('hi'));
      if (path === '/auth/verify-otp') {
        return Promise.resolve({
          data: { data: { accessToken: 'otp-access-token', user: {
            id: 'patient-id', role: 'patient', full_name: 'Asha Patient', preferred_language: 'en',
          } } },
        });
      }
      return Promise.reject(new Error(`Unexpected auth request: ${path}`));
    });
  });

  it('restores the account language and preserves a saved user choice through logout and login', async () => {
    render(<AuthProvider><AuthProbe /></AuthProvider>);
    expect(await screen.findByTestId('auth-language')).toHaveTextContent('te');
    expect(i18n.language).toBe('te');
    expect(localStorage.getItem('aarogya-language')).toBe('te');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); });
    await waitFor(() => expect(screen.getByTestId('auth-language')).toHaveTextContent('signed-out'));
    expect(localStorage.getItem('aarogya-language')).toBe('te');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in again' })); });
    await waitFor(() => expect(screen.getByTestId('auth-language')).toHaveTextContent('te'));
    expect(i18n.language).toBe('te');
    expect(apiMock.put).toHaveBeenCalledWith('/languages/preference', { language_code: 'te' });
  });

  it('uses the fixed-purpose patient OTP verification endpoint', async () => {
    render(<AuthProvider><AuthProbe /></AuthProvider>);
    await screen.findByTestId('auth-language');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in with OTP' })); });

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/auth/verify-otp', {
      challenge_id: 'challenge-id',
      code: '123456',
    }));
    expect(screen.getByTestId('auth-language')).toHaveTextContent('te');
  });
});
