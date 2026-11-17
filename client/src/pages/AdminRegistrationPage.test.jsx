import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import api from '../services/api.js';
import AdminRegistrationPage from './AdminRegistrationPage.jsx';

const authState = vi.hoisted(() => ({
  user: { role: 'super_admin', preferred_language: 'en', permissions: ['users:manage'] },
  loading: false,
}));
vi.mock('../services/api.js', () => ({ default: { post: vi.fn() } }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));

describe('Super Admin administrator registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { role: 'super_admin', preferred_language: 'en', permissions: ['users:manage'] };
  });

  it('requires Super Admin sign-in before displaying registration fields', () => {
    authState.user = null;
    render(
      <MemoryRouter>
        <AdminRegistrationPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Sign in as the Super Admin/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Admin Login' })).toHaveAttribute('href', '/login');
  });

  it('creates a pending administrator through the protected admin API', async () => {
    api.post.mockResolvedValue({ data: { data: { id: 'new-admin' } } });
    render(
      <MemoryRouter>
        <AdminRegistrationPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Synthetic Admin' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.test' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543211' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'syntheticadmin' } });
    fireEvent.change(screen.getByLabelText('Initial password'), { target: { value: 'StrongPass1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'StrongPass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Admin Account' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users', {
      full_name: 'Synthetic Admin',
      email: 'admin@example.test',
      mobile: '9876543211',
      username: 'syntheticadmin',
      password: 'StrongPass1',
      confirm_password: 'StrongPass1',
      role: 'admin',
      preferred_language: 'en',
      profile: {},
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('awaiting Super Admin approval');
  });

  it('shows a clear duplicate-username error', async () => {
    api.post.mockRejectedValue({ response: { data: { code: 'ADMIN_USERNAME_EXISTS' } } });
    render(
      <MemoryRouter>
        <AdminRegistrationPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Synthetic Admin' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.test' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543211' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'syntheticadmin' } });
    fireEvent.change(screen.getByLabelText('Initial password'), { target: { value: 'StrongPass1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'StrongPass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Admin Account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This username is already registered.');
  });
});
