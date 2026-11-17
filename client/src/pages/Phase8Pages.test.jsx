import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authState = vi.hoisted(() => ({ user: null }));
const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../auth/AuthContext.jsx', () => ({
  useAuth: () => ({ user: authState.user }),
}));
vi.mock('../services/api.js', () => ({ default: apiMock }));

import AppointmentBookingPage from './AppointmentBookingPage.jsx';
import ReferralPage from './ReferralPage.jsx';
import { ToastProvider } from '../components/ui/Toast.jsx';

const patientId = 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const doctorId = 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const hospitalId = 'e4b33580-1c35-4ae3-bf49-1f35532fd3ce';
const referralId = 'f4b33580-1c35-4ae3-bf49-1f35532fd3ce';

function renderPage(page, initialEntry = '/') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>{page}</MemoryRouter>
    </ToastProvider>,
  );
}

describe('Phase 8 appointment and referral screens', () => {
  beforeEach(() => {
    authState.user = { id: 'user-id', role: 'patient', full_name: 'Synthetic Patient' };
    vi.clearAllMocks();
    apiMock.post.mockResolvedValue({
      data: { success: true, data: { appointment: { id: 'appointment-ref-001', status: 'booked' } } },
    });
  });

  it('books an appointment using doctor availability and available slot data', async () => {
    apiMock.get.mockImplementation((path, options) => {
      if (path === '/appointments' && options?.params?.directory) {
        return Promise.resolve({
          data: { data: { directory: {
            doctors: [{ id: doctorId, name: 'Demo Dentist', specialty: 'Demo dentistry', hospital_id: hospitalId, phc_id: null, is_demo: true }],
            hospitals: [{ id: hospitalId, name: 'AREA HOSPITAL - ARAKU', facility_type: 'hospital' }],
            phcs: [],
          } } },
        });
      }
      if (path === '/auth/profile') {
        return Promise.resolve({ data: { data: { user: { profile: { id: patientId } } } } });
      }
      return Promise.resolve({ data: { data: { available_slots: ['09:00'] } } });
    });

    it('prefills the selected doctor, facility, and video mode from the consultation page', async () => {
      apiMock.get.mockImplementation((path, options) => {
        if (path === '/appointments' && options?.params?.directory) {
          return Promise.resolve({
            data: { data: { directory: {
              doctors: [{ id: doctorId, name: 'Assigned Dentist', specialty: 'Dental', hospital_id: hospitalId, phc_id: null }],
              hospitals: [{ id: hospitalId, name: 'AREA HOSPITAL - ARAKU', facility_type: 'hospital' }],
              phcs: [],
            } } },
          });
        }
        if (path === '/auth/profile') {
          return Promise.resolve({ data: { data: { user: { profile: { id: patientId } } } } });
        }
        return Promise.resolve({ data: { data: { available_slots: ['09:00'] } } });
      });

      renderPage(
        <AppointmentBookingPage />,
        `/appointments/book?doctor_id=${doctorId}&facility=hospital%3A${hospitalId}&mode=video`,
      );

      const facilitySelect = await screen.findByLabelText('Select hospital or health centre');
      await waitFor(() => expect(facilitySelect).toHaveValue('AREA HOSPITAL - ARAKU'));
      expect(screen.getByLabelText('Doctor')).toHaveValue('Assigned Dentist · Dental');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(await screen.findByRole('button', { name: /09:00/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      expect(screen.getByLabelText('Visit mode')).toHaveValue('video');
    });

    renderPage(<AppointmentBookingPage />);
    const facilitySelect = await screen.findByLabelText('Select hospital or health centre');
    fireEvent.change(facilitySelect, { target: { value: 'ARAKU' } });
    fireEvent.click(screen.getByRole('option', { name: 'AREA HOSPITAL - ARAKU' }));
    expect(facilitySelect).toHaveValue('AREA HOSPITAL - ARAKU');
    const doctorSelect = screen.getByLabelText('Doctor');
    expect(screen.getByText(/Demo data only: these sample doctors and schedules are synthetic/)).toBeInTheDocument();
    fireEvent.focus(doctorSelect);
    fireEvent.change(doctorSelect, { target: { value: 'Demo Dent' } });
    expect(screen.getByRole('option', { name: 'DEMO · Demo Dentist · Demo dentistry' })).toBeInTheDocument();
    fireEvent.keyDown(doctorSelect, { key: 'ArrowDown' });
    fireEvent.keyDown(doctorSelect, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: /09:00/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Reason for visit'), { target: { value: 'Synthetic demo visit' } });
    expect(screen.getByText(/Availability is checked again when you submit the request/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/appointments', expect.objectContaining({
      patient_id: patientId,
      doctor_id: doctorId,
      hospital_id: hospitalId,
      time_slot: '09:00',
      reason: 'Synthetic demo visit',
    })));
    expect(await screen.findByRole('heading', { name: 'Your appointment request has been submitted.' })).toBeInTheDocument();
    expect(screen.getByText('Pending facility confirmation')).toBeInTheDocument();
    expect(screen.getByText('appointment-ref-001')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/appointments', expect.objectContaining({
      params: expect.objectContaining({ hospital_id: hospitalId }),
    }));
  });

  it('lists every supplied facility type and filters doctors to the selected facility', async () => {
    apiMock.get.mockImplementation((path, options) => {
      if (path === '/appointments' && options?.params?.directory) {
        return Promise.resolve({
          data: { data: { directory: {
            doctors: [{ id: doctorId, name: 'Demo Dentist', hospital_id: hospitalId, phc_id: null }],
            hospitals: [{ id: hospitalId, name: 'AREA HOSPITAL - ARAKU', facility_type: 'hospital' }],
            phcs: [{
              id: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
              name: 'CHC -MUNCHINGIPUTTU',
              facility_type: 'chc',
            }],
          } } },
        });
      }
      return Promise.resolve({ data: { data: { user: { profile: { id: patientId } } } } });
    });

    renderPage(<AppointmentBookingPage />);
    const facilitySelect = await screen.findByLabelText('Select hospital or health centre');
    fireEvent.focus(facilitySelect);
    fireEvent.change(facilitySelect, { target: { value: 'CHC' } });
    fireEvent.click(screen.getByRole('option', { name: 'CHC -MUNCHINGIPUTTU' }));

    expect(await screen.findByText('No doctors are currently listed for this facility.')).toBeInTheDocument();
    const doctorSelect = screen.getByLabelText('Doctor');
    fireEvent.focus(doctorSelect);
    expect(screen.queryByRole('option', { name: /Demo Dentist/ })).not.toBeInTheDocument();
  });

  it('searches names case-insensitively and partially, supports keyboard selection and clearing', async () => {
    apiMock.get.mockImplementation((path, options) => {
      if (path === '/appointments' && options?.params?.directory) {
        return Promise.resolve({
          data: { data: { directory: {
            doctors: [],
            facilities: [
              { id: hospitalId, name: 'AREA HOSPITAL - ARAKU', facility_type: 'hospital' },
              { id: referralId, name: 'GOVERNMENT GENERAL HOSPITAL - PADERU', facility_type: 'hospital' },
            ],
            hospitals: [],
            phcs: [],
          } } },
        });
      }
      return Promise.resolve({ data: { data: { user: { profile: { id: patientId } } } } });
    });

    renderPage(<AppointmentBookingPage />);
    const facilitySelect = await screen.findByLabelText('Select hospital or health centre');
    fireEvent.focus(facilitySelect);
    fireEvent.change(facilitySelect, { target: { value: 'govERNMENT general hospital - pad' } });
    expect(screen.getByRole('option', { name: 'GOVERNMENT GENERAL HOSPITAL - PADERU' })).toBeInTheDocument();
    fireEvent.keyDown(facilitySelect, { key: 'ArrowDown' });
    fireEvent.keyDown(facilitySelect, { key: 'Enter' });
    expect(facilitySelect).toHaveValue('GOVERNMENT GENERAL HOSPITAL - PADERU');

    fireEvent.click(screen.getByRole('button', { name: 'Clear selected facility' }));
    expect(facilitySelect).toHaveValue('');
    fireEvent.focus(facilitySelect);
    fireEvent.change(facilitySelect, { target: { value: 'not a facility' } });
    expect(screen.getByText('No facilities found.')).toBeInTheDocument();
    fireEvent.change(facilitySelect, { target: { value: 'AREA HOSPITAL - ARAKU' } });
    expect(screen.getByRole('option', { name: 'AREA HOSPITAL - ARAKU' })).toBeInTheDocument();
  });

  it('shows doctor and facility validation when Continue is clicked without selections', async () => {
    apiMock.get.mockImplementation((path) => {
      if (path === '/appointments') {
        return Promise.resolve({
          data: { data: { directory: { doctors: [], hospitals: [], phcs: [] } } },
        });

        it('shows a directory loading error instead of an empty results message and can retry', async () => {
          let directoryRequestCount = 0;
          apiMock.get.mockImplementation((path, options) => {
            if (path === '/appointments' && options?.params?.directory) {
              directoryRequestCount += 1;
              if (directoryRequestCount === 1) return Promise.reject(new Error('Directory unavailable'));
              return Promise.resolve({
                data: { data: { directory: {
                  doctors: [],
                  hospitals: [{ id: hospitalId, name: 'AREA HOSPITAL - ARAKU', facility_type: 'hospital' }],
                  phcs: [],
                } } },
              });
            }
            return Promise.resolve({ data: { data: { user: { profile: { id: patientId } } } } });
          });

          renderPage(<AppointmentBookingPage />);
          expect(await screen.findByText('The facility list could not be loaded.')).toBeInTheDocument();
          expect(screen.queryByText('No facilities found.')).not.toBeInTheDocument();
          fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

          const facilitySelect = await screen.findByLabelText('Select hospital or health centre');
          await waitFor(() => expect(facilitySelect).not.toBeDisabled());
          fireEvent.focus(facilitySelect);
          fireEvent.change(facilitySelect, { target: { value: 'ARAKU' } });
          expect(screen.getByRole('option', { name: 'AREA HOSPITAL - ARAKU' })).toBeInTheDocument();
        });

        it('keeps the facility selector available when loading the patient profile fails', async () => {
          apiMock.get.mockImplementation((path, options) => {
            if (path === '/appointments' && options?.params?.directory) {
              return Promise.resolve({
                data: { data: { directory: {
                  doctors: [],
                  hospitals: [{ id: hospitalId, name: 'AREA HOSPITAL - ARAKU', facility_type: 'hospital' }],
                  phcs: [],
                } } },
              });
            }
            return Promise.reject(new Error('Profile unavailable'));
          });

          renderPage(<AppointmentBookingPage />);
          const facilitySelect = await screen.findByLabelText('Select hospital or health centre');
          await waitFor(() => expect(facilitySelect).not.toBeDisabled());
          fireEvent.focus(facilitySelect);
          fireEvent.change(facilitySelect, { target: { value: 'ARAKU' } });

          expect(screen.getByRole('option', { name: 'AREA HOSPITAL - ARAKU' })).toBeInTheDocument();
        });
      }
      return Promise.resolve({ data: { data: { user: { profile: { id: patientId } } } } });
    });

    renderPage(<AppointmentBookingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Please select a doctor.')).toBeInTheDocument();
    expect(screen.getByText('Please select a hospital or PHC.')).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('lets the assigned specialist update a referral and displays its timeline', async () => {
    authState.user = { id: 'specialist-user', role: 'specialist', full_name: 'Demo Specialist' };
    apiMock.get.mockResolvedValue({
      data: { data: { items: [{
        id: referralId,
        patient_id: patientId,
        patient_name: 'Synthetic Patient',
        patient_code: 'AD-2026-000001',
        specialist_name: 'Demo Specialist',
        hospital_name: 'Demo Hospital',
        status: 'pending',
        urgency: 'soon',
        reason: 'Synthetic referral reason',
        documents: [],
        timeline: [{
          id: 'event-id',
          event_type: 'created',
          actor_name: 'Demo Doctor',
          created_at: '2026-10-31T00:00:00.000Z',
          details: { status: 'pending' },
        }],
      }] } },
    });

    renderPage(<ReferralPage />);
    expect(await screen.findByText('Synthetic referral reason')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Status timeline'));
    expect(screen.getByText('Referral created')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/referrals', {
      action: 'update_status',
      referral_id: referralId,
      status: 'accepted',
    }));
  });
});
