import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const authState = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));

import ChangePasswordPage from './ChangePasswordPage.jsx';

describe('forced password change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.changePassword.mockResolvedValue(undefined);
  });

  it('omits current password and independently shows or hides both new password fields', async () => {
    render(
      <MemoryRouter initialEntries={['/change-password']}>
        <Routes>
          <Route element={<ChangePasswordPage />} path="/change-password" />
          <Route element={<p>Password updated</p>} path="/" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText('Temporary or current password')).not.toBeInTheDocument();
    const newPassword = screen.getByLabelText('New password');
    const confirmation = screen.getByLabelText('Confirm password');
    expect(newPassword).toHaveAttribute('type', 'password');
    expect(confirmation).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getAllByRole('button', { name: 'Show password' })[0]);
    expect(newPassword).toHaveAttribute('type', 'text');
    expect(confirmation).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(confirmation).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide password' })[0]);
    expect(newPassword).toHaveAttribute('type', 'password');
    expect(confirmation).toHaveAttribute('type', 'text');

    fireEvent.change(newPassword, { target: { value: 'NewStrongPass1' } });
    fireEvent.change(confirmation, { target: { value: 'NewStrongPass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(authState.changePassword).toHaveBeenCalledWith('NewStrongPass1', 'NewStrongPass1');
    expect(await screen.findByText('Password updated')).toBeInTheDocument();
  });
});
