import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const authState = vi.hoisted(() => ({ user: null }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: authState.user }) }));

import RoleRoute from './RoleRoute.jsx';

describe('RoleRoute', () => {
  beforeEach(() => {
    authState.user = { role: 'patient' };
  });

  function renderRoutes() {
    return render(
      <MemoryRouter initialEntries={['/restricted']}>
        <Routes>
          <Route path="/restricted" element={<RoleRoute roles={['doctor']} />}>
            <Route index element={<p>restricted content</p>} />
          </Route>
          <Route path="/patient" element={<p>patient dashboard</p>} />
          <Route path="/login" element={<p>sign-in page</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('redirects an authenticated user to their role dashboard when disallowed', async () => {
    renderRoutes();
    expect(await screen.findByText('patient dashboard')).toBeInTheDocument();
    expect(screen.queryByText('restricted content')).not.toBeInTheDocument();
  });

  it('allows the configured role', async () => {
    authState.user = { role: 'doctor' };
    renderRoutes();
    expect(await screen.findByText('restricted content')).toBeInTheDocument();
  });

  it('sends an anonymous user to sign in', async () => {
    authState.user = null;
    renderRoutes();
    expect(await screen.findByText('sign-in page')).toBeInTheDocument();
  });
});
