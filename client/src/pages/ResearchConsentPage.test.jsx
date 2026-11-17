import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast.jsx';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../services/api.js', () => ({ default: apiMock }));

import ResearchConsentPage from './ResearchConsentPage.jsx';

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <ResearchConsentPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('participant research consent page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays the notice and keeps participation unavailable without governance configuration', async () => {
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          governance: { enabled: false },
          consent: null,
          history: [],
        },
      },
    });
    renderPage();

    expect(await screen.findByText('Research participation is unavailable until the institution has obtained required governance approval and configured the approval reference, contact, and approved retention policy.')).toBeInTheDocument();
    expect(screen.getByText(/This is pseudonymization, not guaranteed anonymity/)).toBeInTheDocument();
    expect(screen.getByText(/Existing clinical records are not deleted or changed/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('requires the separate explicit checkbox before recording research AI training consent', async () => {
    apiMock.get
      .mockResolvedValueOnce({
        data: {
          data: {
            governance: {
              enabled: true,
              approval_reference: 'institutional-test-reference',
              governance_body: 'test governance body',
              contact: 'research@example.invalid',
              retention_policy: 'test policy',
            },
            consent: null,
            history: [],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            governance: { enabled: true },
            consent: { id: 'consent-1', status: 'granted', consent_version: '1.0' },
            history: [{ id: 'consent-1', status: 'granted', consent_version: '1.0' }],
          },
        },
      });
    apiMock.post.mockResolvedValue({ data: { success: true } });
    renderPage();

    const checkbox = await screen.findByRole('checkbox');
    const grantButton = screen.getByRole('button', { name: 'Give research consent' });
    expect(grantButton).toBeDisabled();
    fireEvent.click(checkbox);
    expect(grantButton).toBeEnabled();
    fireEvent.click(grantButton);

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith('/research/consent', {
        research_ai_training: true,
        language: 'en',
      });
    });
    expect(await screen.findByText('Research consent is active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw research consent' })).toBeInTheDocument();
    expect(screen.getByText('Consent granted')).toBeInTheDocument();
  });

  it('lets a participant withdraw active consent and refreshes the status', async () => {
    apiMock.get
      .mockResolvedValueOnce({
        data: {
          data: {
            governance: { enabled: true },
            consent: { id: 'consent-1', status: 'granted', consent_version: '1.0' },
            history: [{ id: 'consent-1', status: 'granted', consent_version: '1.0' }],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            governance: { enabled: true },
            consent: {
              id: 'withdrawal-1',
              status: 'withdrawn',
              consent_version: '1.0',
              withdrawn_at: '2026-11-10T12:00:00.000Z',
            },
            history: [
              { id: 'withdrawal-1', status: 'withdrawn', consent_version: '1.0' },
              { id: 'consent-1', status: 'granted', consent_version: '1.0' },
            ],
          },
        },
      });
    apiMock.post.mockResolvedValue({ data: { success: true } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw research consent' }));

    expect(await screen.findByText('Research consent is withdrawn')).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/research/consent/withdraw', {});
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });
});
