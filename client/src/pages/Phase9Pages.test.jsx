import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authState = vi.hoisted(() => ({ user: null }));
const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock('../services/api.js', () => ({ default: apiMock }));

import MedicineReminderPage from './MedicineReminderPage.jsx';
import EmergencySosPage from './EmergencySosPage.jsx';
import { ToastProvider } from '../components/ui/Toast.jsx';

const patientId = 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce';

function renderPage(page) {
  return render(<ToastProvider><MemoryRouter>{page}</MemoryRouter></ToastProvider>);
}

describe('Phase 9 patient screens', () => {
  beforeEach(() => {
    authState.user = {
      id: '7c31cbd1-ef65-4e8d-a526-c90dfb51192d',
      role: 'patient',
      profile: { id: patientId },
      full_name: 'Synthetic Patient',
    };
    vi.clearAllMocks();
    apiMock.post.mockResolvedValue({
      data: { data: { medicine: { id: 'medicine-id' }, request: { id: 'request-id' }, callable_options: { hospitals: [] } } },
    });
    apiMock.get.mockImplementation((path) => {
      if (path === '/emergency/contacts') {
        return Promise.resolve({ data: { data: { contacts: [], requests: [] } } });
      }
      if (path === '/emergency/nearby-hospitals') {
        return Promise.resolve({ data: { data: { hospitals: [] } } });
      }
      if (path === '/medicines') return Promise.resolve({ data: { data: { items: [] } } });
      if (path === '/medicine-reminders') return Promise.resolve({ data: { data: { items: [] } } });
      return Promise.resolve({ data: { data: { items: [], adherence: [] } } });
    });
  });

  it('saves a medicine and reminder through the API', async () => {
    renderPage(<MedicineReminderPage />);
    fireEvent.change(await screen.findByLabelText('Medicine name'), { target: { value: 'Demo tablet' } });
    fireEvent.change(screen.getByLabelText('Dosage'), { target: { value: '1 tablet' } });
    fireEvent.change(screen.getByLabelText('Form'), { target: { value: 'tablet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save medicine and reminder' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/medicine-reminders', expect.objectContaining({
      medicine_id: 'medicine-id',
      reminder_times: ['09:00'],
    })));
  });

  it('provides a direct 108 link and never requests location when sharing is not selected', async () => {
    renderPage(<EmergencySosPage />);
    expect(await screen.findByRole('link', { name: 'Call 108' })).toHaveAttribute('href', 'tel:108');
    fireEvent.click(screen.getByRole('button', { name: 'Request emergency help' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm SOS request' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/emergency/sos', expect.objectContaining({
      location_consent: false,
      contact_ids: [],
    })));
  });
});
