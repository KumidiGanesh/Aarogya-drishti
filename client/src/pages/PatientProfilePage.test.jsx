import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast.jsx';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const authState = vi.hoisted(() => ({ user: { role: 'patient' } }));
vi.mock('../services/api.js', () => ({ default: apiMock }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));

import PatientProfilePage from './PatientProfilePage.jsx';

const basePatient = {
  id: 'patient-1',
  full_name: 'Synthetic Patient',
  patient_code: 'SYN-001',
  district: 'Test district',
  mandal: 'Test mandal',
  consents: [{ consent_type: 'ai_processing', granted: false, version: 1 }],
};

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <PatientProfilePage patientId="patient-1" />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('patient profile research AI training consent manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { role: 'patient' };
    apiMock.get.mockImplementation(async (path) => {
      if (path === '/patients/patient-1')
        return { data: { data: { patient: basePatient } } };
      if (path === '/research/consent')
        return {
          data: {
            data: {
              governance: { enabled: false },
              consent: null,
              history: [],
            },
          },
        };
      throw new Error(`Unexpected API request: ${path}`);
    });
    apiMock.post.mockResolvedValue({ data: { success: true } });
  });

  it('shows not granted by default and does not offer a grant while governance is unavailable', async () => {
    renderPage();
    const row = await screen.findByText('Research AI Training').then((label) => label.closest('.patient-consent-row'));

    expect(within(row).getByText('Not granted')).toBeInTheDocument();
    expect(within(row).getByText(/Optional and separate from clinical care and Gemini screening/))
      .toBeInTheDocument();
    expect(within(row).getByRole('status')).toHaveTextContent(
      'Research participation is unavailable until required governance information is configured.',
    );
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Grant research consent' }))
      .not.toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /Review full research purpose/ }))
      .toHaveAttribute('href', '/patient/research-consent');
    expect(apiMock.get).toHaveBeenCalledWith('/research/consent');
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('requires explicit agreement and records research consent independently of Gemini consent', async () => {
    const responses = [
      {
        data: {
          data: {
            governance: { enabled: true },
            consent: null,
            history: [],
          },
        },
      },
      {
        data: {
          data: {
            governance: { enabled: true },
            consent: {
              id: 'research-consent-1',
              status: 'granted',
              consent_version: '2.1',
              granted_at: '2026-11-10T12:00:00.000Z',
            },
            history: [{
              id: 'research-consent-1',
              status: 'granted',
              consent_version: '2.1',
              granted_at: '2026-11-10T12:00:00.000Z',
            }],
          },
        },
      },
    ];
    apiMock.get.mockImplementation((path) => {
      if (path === '/patients/patient-1')
        return Promise.resolve({ data: { data: { patient: basePatient } } });
      if (path === '/research/consent') return Promise.resolve(responses.shift());
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderPage();
    let row = await screen.findByText('Research AI Training').then((label) => label.closest('.patient-consent-row'));
    const agree = within(row).getByRole('checkbox', {
      name: /I have read the research purpose above/,
    });
    const grant = within(row).getByRole('button', { name: 'Grant research consent' });
    expect(grant).toBeDisabled();
    fireEvent.click(agree);
    fireEvent.click(grant);

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith('/research/consent', {
        research_ai_training: true,
        language: 'en',
      });
    });
    row = screen.getByText('Research AI Training').closest('.patient-consent-row');
    expect(within(row).getByText('Granted')).toBeInTheDocument();
    expect(within(row).getByText('Consent version: 2.1')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Revoke research consent' })).toBeInTheDocument();
    const geminiRow = screen.getByText('AI image screening with Google Gemini')
      .closest('.patient-consent-row');
    expect(within(geminiRow).getByText('Revoked')).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalledWith(
      '/patients/patient-1/consent',
      expect.objectContaining({ consent_type: 'ai_processing', granted: true }),
    );
  });

  it('shows revoked status, withdrawal date, and renewal only after explicit agreement', async () => {
    const researchResponse = {
      data: {
        data: {
          governance: { enabled: true },
          consent: {
            id: 'withdrawal-1',
            status: 'withdrawn',
            consent_version: '2.0',
            withdrawn_at: '2026-11-09T12:00:00.000Z',
          },
          history: [{
            id: 'withdrawal-1',
            status: 'withdrawn',
            consent_version: '2.0',
            withdrawn_at: '2026-11-09T12:00:00.000Z',
          }],
        },
      },
    };
    apiMock.get.mockImplementation((path) => {
      if (path === '/patients/patient-1')
        return Promise.resolve({ data: { data: { patient: basePatient } } });
      if (path === '/research/consent') return Promise.resolve(researchResponse);
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderPage();
    const row = (await screen.findByText('Research AI Training')).closest('.patient-consent-row');
    expect(await within(row).findByText('Revoked')).toBeInTheDocument();
    expect(within(row).getByText('Consent version: 2.0')).toBeInTheDocument();
    expect(within(row).getByText(/Revoked:/)).toBeInTheDocument();
    expect(within(row).getByRole('checkbox')).not.toBeChecked();
    expect(within(row).getByRole('button', { name: 'Grant research consent' })).toBeDisabled();
  });

  it('revokes active research consent through the research API after confirmation', async () => {
    const responses = [
      {
        data: {
          data: {
            governance: { enabled: true },
            consent: {
              id: 'research-consent-1',
              status: 'granted',
              consent_version: '1.0',
              granted_at: '2026-11-08T12:00:00.000Z',
            },
            history: [{
              id: 'research-consent-1',
              status: 'granted',
              consent_version: '1.0',
              granted_at: '2026-11-08T12:00:00.000Z',
            }],
          },
        },
      },
      {
        data: {
          data: {
            governance: { enabled: true },
            consent: {
              id: 'withdrawal-1',
              status: 'withdrawn',
              consent_version: '1.0',
              withdrawn_at: '2026-11-10T12:00:00.000Z',
            },
            history: [{
              id: 'withdrawal-1',
              status: 'withdrawn',
              consent_version: '1.0',
              withdrawn_at: '2026-11-10T12:00:00.000Z',
            }],
          },
        },
      },
    ];
    apiMock.get.mockImplementation((path) => {
      if (path === '/patients/patient-1')
        return Promise.resolve({ data: { data: { patient: basePatient } } });
      if (path === '/research/consent') return Promise.resolve(responses.shift());
      throw new Error(`Unexpected API request: ${path}`);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage();
    const row = (await screen.findByText('Research AI Training')).closest('.patient-consent-row');
    fireEvent.click(await within(row).findByRole('button', { name: 'Revoke research consent' }));

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith('/research/consent/withdraw', {});
    });
    expect(await within(row).findByText('Revoked')).toBeInTheDocument();
  });
});
