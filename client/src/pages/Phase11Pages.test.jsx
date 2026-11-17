import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import api from '../services/api.js';
import { ToastProvider } from '../components/ui/Toast.jsx';
import AppointmentListPage from './AppointmentListPage.jsx';
import NotificationsPage from './NotificationsPage.jsx';
import ConsultationsPage from './ConsultationsPage.jsx';
import AnalyticsPage from './AnalyticsPage.jsx';
import SettingsPage from './SettingsPage.jsx';

const authState = vi.hoisted(() => ({
  user: { id: 'doctor-user', role: 'doctor', permissions: [] },
  logout: vi.fn(),
}));
const signaling = vi.hoisted(() => {
  const handlers = {};
  const socket = {
    connected: true,
    on: vi.fn((event, handler) => { handlers[event] = handler; }),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(() => handlers.connect?.()),
  };
  return {
    handlers,
    socket,
    createSignalingSocket: vi.fn(() => socket),
    emitSignal: vi.fn(),
  };
});
vi.mock('../services/api.js', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));
vi.mock('../services/signaling.js', () => ({
  createSignalingSocket: signaling.createSignalingSocket,
  emitSignal: signaling.emitSignal,
}));

function renderPage(Page) {
  return render(
    <MemoryRouter>
      <ToastProvider><Page /></ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(signaling.handlers).forEach((event) => delete signaling.handlers[event]);
  signaling.socket.on.mockImplementation((event, handler) => { signaling.handlers[event] = handler; });
  signaling.socket.connect.mockImplementation(() => signaling.handlers.connect?.());
  authState.user = { id: 'doctor-user', role: 'doctor', permissions: [] };
  api.get.mockImplementation(async (path) => {
    if (path === '/notifications') return { data: { data: { items: [], unread_count: 2 } } };
    if (path === '/appointments') return { data: { data: { items: [] } } };
    if (path === '/consultations')
      return {
        data: { data: { items: [], availability: [], call_signaling_configured: true } },
      };
    if (path === '/reports/analytics')
      return {
        data: {
          data: {
            total_registrations: 3,
            village_statistics: [],
            phc_statistics: [],
            district_statistics: [],
            screening_statistics: [],
            referral_statistics: [],
            appointment_statistics: [],
            medicine_adherence: [],
            emergency_statistics: [],
          },
        },
      };
    if (path === '/settings')
      return {
        data: {
          data: {
            account: {
              full_name: 'Synthetic Doctor',
              mobile: '9876543210',
              email: 'doctor@example.test',
            },
            language: 'en',
            notification_preferences: {
              channels: { in_app: true },
              quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
            },
            privacy: {},
            font_size: 'medium',
            voice: { enabled: true, language: 'en-IN', speed: 1 },
          },
        },
      };
    throw new Error(`Unexpected API request: ${path}`);
  });
  api.put.mockResolvedValue({ data: { data: { language: 'en', font_size: 'large' } } });
  api.post.mockResolvedValue({ data: { data: { consultation_id: 'consultation-id' } } });
  signaling.emitSignal.mockResolvedValue({
    id: 'call-id',
    consultation_id: 'consultation-id',
    type: 'video',
    call_token: 'short-lived-token',
    ice_servers: [{ urls: ['turns:turn.example.test:5349'], username: 'temporary', credential: 'temporary' }],
    recipient_online: true,
  });
});

describe('Phase 11 client pages', () => {
  it('shows patient bookings in the doctor schedule without a booking link', async () => {
    api.get.mockImplementation(async (_path, options = {}) => ({
      data: {
        data: options.params?.preferences
          ? { preferences: { enabled: true, reminders_24h: true, reminders_2h: true } }
          : {
              items: [{
                id: 'appointment-1',
                patient_name: 'Registered Patient',
                doctor_name: 'Synthetic Doctor',
                specialty: 'Dentistry',
                facility_name: 'Demo PHC',
                scheduled_at: '2026-11-20T09:00:00.000Z',
                status: 'booked',
                mode: 'in_person',
              }],
            },
      },
    }));

    renderPage(AppointmentListPage);

    expect(await screen.findByRole('heading', { name: 'Registered Patient' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Book an appointment' })).not.toBeInTheDocument();
  });

  it('loads the private notification list and unread count', async () => {
    renderPage(NotificationsPage);
    expect(await screen.findByText('2 unread')).toBeInTheDocument();
    expect(screen.getByText('You have no notifications.')).toBeInTheDocument();
  });

  it('shows telemedicine appointments and an empty consultation state', async () => {
    renderPage(ConsultationsPage);
    expect(await screen.findByText('Scheduled audio/video appointments')).toBeInTheDocument();
    expect(screen.getByText('No consultations are scheduled.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book an audio/video appointment' })).toHaveAttribute(
      'href',
      '/appointments/book',
    );
  });

  it('lets patients choose a listed doctor and opens a prefilled audio/video booking', async () => {
    authState.user = { id: 'patient-user', role: 'patient', permissions: [] };
    api.get.mockImplementation(async (path, options = {}) => {
      if (path === '/appointments') return { data: { data: { items: [] } } };
      if (path === '/consultations' && options.params?.availability === 'true') {
        return {
          data: { data: { items: [], call_signaling_configured: true, availability: [{
            id: 'doctor-profile',
            full_name: 'Synthetic Dentist',
            specialty: 'Oral Surgery',
            hospital_id: 'hospital-id',
            online_status: 'online',
          }] } },
        };
      }
      if (path === '/consultations') {
        return { data: { data: { items: [], call_signaling_configured: true } } };
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderPage(ConsultationsPage);

    expect(await screen.findByRole('heading', { name: 'Available doctors' })).toBeInTheDocument();
    expect(screen.getByText('Synthetic Dentist')).toBeInTheDocument();
    expect(screen.getByText('Specialization: Oral Surgery · Online')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book audio consultation' })).toHaveAttribute(
      'href',
      '/appointments/book?doctor_id=doctor-profile&mode=audio&facility=hospital%3Ahospital-id',
    );
    expect(screen.getByRole('link', { name: 'Book video consultation' })).toHaveAttribute(
      'href',
      '/appointments/book?doctor_id=doctor-profile&mode=video&facility=hospital%3Ahospital-id',
    );
  });

  it('explains missing TURN configuration and disables starting a consultation', async () => {
    api.get.mockImplementation(async (path) => {
      if (path === '/appointments') return { data: { data: { items: [] } } };
      if (path === '/consultations') {
        return {
          data: { data: { call_signaling_configured: false, items: [{
            id: 'consultation-id',
            patient_name: 'Synthetic Patient',
            doctor_name: 'Synthetic Doctor',
            scheduled_at: new Date().toISOString(),
            mode: 'video',
            status: 'scheduled',
            join_available: true,
            call_window_open: true,
            teleconsultation_consent_granted: true,
          }] } },
        };
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderPage(ConsultationsPage);

    expect(await screen.findByText(/Audio\/video calling is disabled/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(signaling.emitSignal).not.toHaveBeenCalled();
  });

  it('initiates an authenticated call for an available appointment', async () => {
    api.get.mockImplementation(async (path) => {
      if (path === '/appointments') return { data: { data: { items: [] } } };
      if (path === '/consultations')
        return {
          data: {
            data: {
              items: [
                {
                  id: 'consultation-id',
                  patient_name: 'Synthetic Patient',
                  patient_code: 'AD-2026-000001',
                  doctor_name: 'Synthetic Doctor',
                  scheduled_at: new Date().toISOString(),
                  mode: 'video',
                  status: 'scheduled',
                  join_available: true,
                  call_window_open: true,
                  teleconsultation_consent_granted: true,
                },
              ],
            },
          },
        };
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderPage(ConsultationsPage);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    expect(await screen.findByText(/Calling the other participant/)).toBeInTheDocument();
    expect(signaling.emitSignal).toHaveBeenCalledWith(
      signaling.socket,
      'call:initiate',
      { consultation_id: 'consultation-id' },
    );
  });

  it('shows incoming-call consent and only accepts after the user responds', async () => {
    renderPage(ConsultationsPage);
    await screen.findByText('No consultations are scheduled.');
    signaling.handlers['call:incoming']({
      call_id: 'incoming-id',
      consultation_id: 'consultation-id',
      type: 'audio',
      caller_name: 'Registered patient',
      patient_code: 'AD-2026-000001',
      call_token: 'incoming-token',
      ice_servers: [{ urls: ['turns:turn.example.test:5349'] }],
    });

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Registered patient');
    fireEvent.click(screen.getByRole('button', { name: 'Accept call' }));
    expect(signaling.emitSignal).toHaveBeenCalledWith(signaling.socket, 'call:accept', {
      consultation_id: 'consultation-id',
      call_id: 'incoming-id',
    });
    expect(await screen.findByRole('checkbox', {
      name: /I understand and agree to enable my microphone or camera/,
    })).toBeInTheDocument();
  });

  it('starts a doctor call through authenticated signaling rather than the legacy meeting provider', async () => {
    api.get.mockImplementation(async (path) => {
      if (path === '/appointments') return { data: { data: { items: [] } } };
      if (path === '/consultations')
        return {
          data: {
            data: {
              items: [
                {
                  id: 'consultation-id',
                  patient_name: 'Synthetic Patient',
                  doctor_name: 'Synthetic Doctor',
                  scheduled_at: new Date().toISOString(),
                  mode: 'audio',
                  status: 'scheduled',
                  join_available: true,
                  call_window_open: true,
                  teleconsultation_consent_granted: true,
                },
              ],
            },
          },
        };
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderPage(ConsultationsPage);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    expect(await screen.findByText(/Calling the other participant/)).toBeInTheDocument();
    expect(signaling.emitSignal).toHaveBeenCalledWith(signaling.socket, 'call:initiate', {
      consultation_id: 'consultation-id',
    });
  });

  it('loads aggregate analytics and exposes date filtering', async () => {
    renderPage(AnalyticsPage);
    expect(await screen.findByText('3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/reports/analytics',
        expect.objectContaining({
          params: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
        }),
      ),
    );
  });

  it('loads persisted settings and saves user preferences', async () => {
    renderPage(SettingsPage);
    expect(await screen.findByDisplayValue('Synthetic Doctor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/settings',
        expect.objectContaining({
          language: 'en',
          font_size: 'medium',
        }),
      ),
    );
  });
});
