import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
const authMock = vi.hoisted(() => ({
  user: { role: 'doctor', full_name: 'Asha Rao', profile: { specialty: 'Dentistry' } },
}));

vi.mock('../services/api.js', () => ({ default: apiMock }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authMock }));

import i18n from '../i18n/index.js';
import DoctorDashboardPage from './DoctorDashboardPage.jsx';

describe('doctor workspace', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    apiMock.get.mockImplementation((path, options = {}) => {
      if (path === '/patients' && options.params?.limit === 1) return Promise.resolve({ data: { data: { items: [] }, meta: { total: 7 } } });
      if (path === '/patients') return Promise.resolve({
        data: {
          data: { items: [{ id: 'assigned-patient-1', patient_code: 'AD-2026-000001', full_name: 'Assigned Patient', gender: 'female' }] },
          meta: { total: 7 },
        },
      });
      if (path === '/screenings') return Promise.resolve({ data: { data: { items: [] }, meta: { total: 3 } } });
      if (path === '/reports/analytics') return Promise.resolve({ data: { data: { screening_statistics: [{ risk_category: 'high', total: 2 }, { risk_category: 'unanalysed', total: 1 }] } } });
      if (path === '/appointments') return Promise.resolve({ data: { data: { items: [] }, meta: { total: 2 } } });
      return Promise.resolve({ data: { data: { items: [] }, meta: { total: 0 } } });
    });
  });

  it('shows the redesigned welcome, live statistics, actions, and dashboard sections', async () => {
    render(<I18nextProvider i18n={i18n}><MemoryRouter><DoctorDashboardPage /></MemoryRouter></I18nextProvider>);
    expect(await screen.findByRole('heading', { name: 'Welcome back, Dr. Asha Rao!' })).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText('Total Patients')).toBeInTheDocument();
    expect(screen.getByText('Screenings This Month')).toBeInTheDocument();
    expect(screen.getByText('High-Risk Cases')).toBeInTheDocument();
    expect(screen.getAllByText('2', { selector: '.doctor-stat__value' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: /My Patients/ })).toHaveAttribute('href', '/patients');
    expect(screen.queryByRole('link', { name: /Register Patient/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My Patients' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Assigned Patient/ })).toHaveAttribute(
      'href',
      '/patients/assigned-patient-1',
    );
    expect(screen.getByText(/Patient ID: AD-2026-000001/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start Screening/ })).toHaveAttribute('href', '/screenings/new');
    expect(screen.getByRole('link', { name: /Video Consultation/ })).toHaveAttribute('href', '/consultations');
    expect(screen.getByRole('heading', { name: 'Upcoming Appointments' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My Patients' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Health Awareness' })).toBeInTheDocument();
  });

  it('shows patient names and IDs from flat or alternate patient fields', async () => {
    apiMock.get.mockImplementation((path, options = {}) => {
      if (path === '/patients' && options.params?.limit === 1) {
        return Promise.resolve({ data: { data: { items: [] }, meta: { total: 1 } } });
      }
      if (path === '/patients') {
        return Promise.resolve({
          data: {
            items: [{ id: 'alternate-patient-1', patientId: 'ALT-001', name: 'Alternate Patient' }],
          },
        });
      }
      if (path === '/screenings') return Promise.resolve({ data: { data: { items: [] }, meta: { total: 0 } } });
      if (path === '/reports/analytics') return Promise.resolve({ data: { data: { screening_statistics: [] } } });
      if (path === '/appointments') return Promise.resolve({ data: { data: { items: [] }, meta: { total: 0 } } });
      return Promise.resolve({ data: { data: { items: [] }, meta: { total: 0 } } });
    });

    render(<I18nextProvider i18n={i18n}><MemoryRouter><DoctorDashboardPage /></MemoryRouter></I18nextProvider>);

    expect(await screen.findByRole('link', { name: /Alternate Patient/ })).toHaveAttribute(
      'href',
      '/patients/alternate-patient-1',
    );
    expect(screen.getByText('Patient ID: ALT-001')).toBeInTheDocument();
  });

  it('switches dashboard copy immediately and stores all four language choices', async () => {
    render(<I18nextProvider i18n={i18n}><MemoryRouter><DoctorDashboardPage /></MemoryRouter></I18nextProvider>);
    expect(await screen.findByText('Total Patients')).toBeInTheDocument();

    await act(async () => { await i18n.changeLanguage('te'); });
    expect(screen.getByText('మొత్తం రోగులు')).toBeInTheDocument();
    expect(localStorage.getItem('aarogya-language')).toBe('te');

    await act(async () => { await i18n.changeLanguage('hi'); });
    expect(screen.getByText('कुल मरीज़')).toBeInTheDocument();
    expect(localStorage.getItem('aarogya-language')).toBe('hi');

    await act(async () => { await i18n.changeLanguage('or'); });
    expect(screen.getByText('ମୋଟ ରୋଗୀ')).toBeInTheDocument();
    expect(localStorage.getItem('aarogya-language')).toBe('or');

    await act(async () => { await i18n.changeLanguage('en'); });
    expect(screen.getByText('Total Patients')).toBeInTheDocument();
    expect(localStorage.getItem('aarogya-language')).toBe('en');
  });
});
