import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const authState = vi.hoisted(() => ({ user: null, loading: false }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));

import ProtectedRoute from './ProtectedRoute.jsx';

describe('ProtectedRoute patient access', () => {
  beforeEach(() => {
    authState.user = { role: 'patient', must_change_password: false };
    authState.loading = false;
  });

  function renderRoutes(path = '/patient') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/patient" element={<p>patient workspace</p>} />
            <Route path="/change-password" element={<p>change password</p>} />
          </Route>
          <Route path="/login" element={<p>sign in</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('allows an authenticated patient to access their workspace', () => {
    renderRoutes();
    expect(screen.getByText('patient workspace')).toBeInTheDocument();
  });

  it('requires a patient to change the temporary password before continuing', () => {
    authState.user = { role: 'patient', must_change_password: true };
    renderRoutes();
    expect(screen.getByText('change password')).toBeInTheDocument();
  });
});
