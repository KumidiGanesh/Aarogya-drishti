import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';

const authState = vi.hoisted(() => ({
  user: { role: 'patient', full_name: 'Demo Patient' },
}));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));

import i18n from '../i18n/index.js';
import DashboardPage from './DashboardPage.jsx';

describe('role dashboard', () => {
  beforeEach(async () => {
    authState.user = { role: 'patient', full_name: 'Demo Patient' };
    await i18n.changeLanguage('en');
  });

  function renderDashboard() {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  it('shows the Paderu branding and patient-specific workspace links', () => {
    renderDashboard();

    expect(
      screen.getByRole('heading', { name: 'Welcome, Demo Patient' }),
    ).toBeInTheDocument();
    expect(screen.getByText('AAROGYA DRISHTI ITDA PADERU')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My health records' })).toHaveAttribute(
      'href',
      '/patient/records',
    );
    expect(screen.getByRole('link', { name: 'Appointments' })).toHaveAttribute(
      'href',
      '/appointments',
    );
    expect(screen.queryByRole('link', { name: 'User management' })).not.toBeInTheDocument();
  });

  it('shows registration and sync tools for health workers', () => {
    authState.user = { role: 'health_worker', full_name: 'Demo Worker' };
    renderDashboard();

    expect(screen.getByRole('heading', { name: 'Welcome, Demo Worker' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register patient' })).toHaveAttribute(
      'href',
      '/patients/register',
    );
    expect(screen.getByRole('link', { name: 'Offline sync status' })).toHaveAttribute(
      'href',
      '/health-worker/sync-status',
    );
  });
});
