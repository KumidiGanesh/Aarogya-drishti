import { act, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast.jsx';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const authMock = vi.hoisted(() => ({ user: { role: 'doctor', full_name: 'Synthetic doctor' } }));
vi.mock('../services/api.js', () => ({ default: apiMock }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: authMock.user }) }));
vi.mock('../screenings/imageQuality.js', () => ({
  inspectImage: vi.fn(async () => ({ notes: [], score: 1 })),
}));

import ScreeningWorkflowPage from './ScreeningWorkflowPage.jsx';

describe('screening workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.user = { role: 'doctor', full_name: 'Synthetic doctor' };
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    apiMock.get.mockResolvedValue({
      data: { data: { items: [{ id: 'patient-1', patient_code: 'AD-2026-000001', full_name: 'Synthetic patient', mobile: '9000000001' }] } },
    });
    apiMock.post.mockResolvedValue({
      data: { data: { screening: { id: 'screening-1' } } },
    });
  });

  it('creates a screening from patient and typed symptom input', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/screenings/new']}>
          <Routes>
            <Route element={<ScreeningWorkflowPage />} path="/screenings/new" />
            <Route element={<p>Screening details opened</p>} path="/screenings/:id" />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    const patient = await screen.findByRole('button', { name: /Synthetic patient/ });
    fireEvent.click(patient);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mouth ulcer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Oral photos' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
      '/screenings',
      expect.objectContaining({
        patient_id: 'patient-1',
        symptoms: [
          { code: 'mouth_ulcer', severity: 'moderate', duration_days: 0, entered_via: 'typed' },
        ],
      }),
    ));
    expect(await screen.findByText('Screening details opened')).toBeInTheDocument();
  });

  it('lets patients consent, screen themselves, and upload an image without searching other patients', async () => {
    authMock.user = { role: 'patient', id: 'patient-user-1', full_name: 'My patient profile' };
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          user: {
            profile: {
              id: 'patient-1',
              patient_code: 'AD-2026-000001',
              full_name: 'My patient profile',
            },
          },
        },
      },
    });

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/screenings/new']}>
          <Routes>
            <Route element={<ScreeningWorkflowPage />} path="/screenings/new" />
            <Route element={<p>Screening details opened</p>} path="/screenings/:id" />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(await screen.findByText('My patient profile')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/auth/profile');
    expect(apiMock.get).not.toHaveBeenCalledWith('/patients', expect.anything());
    fireEvent.click(screen.getByLabelText(/I agree to collect and store/));
    fireEvent.click(screen.getByLabelText(/I agree to securely store/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mouth ulcer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Choose from gallery'), {
      target: {
        files: [new File(['synthetic image'], 'mouth.jpg', { type: 'image/jpeg' })],
      },
    });
    await screen.findByAltText('Screening images 1');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith('/patients/patient-1/consent', {
        consent_type: 'data_collection',
        granted: true,
        version: 1,
        language: 'en',
      });
      expect(apiMock.post).toHaveBeenCalledWith('/patients/patient-1/consent', {
        consent_type: 'photo',
        granted: true,
        version: 1,
        language: 'en',
      });
      expect(apiMock.post).toHaveBeenCalledWith('/patients/patient-1/consent', {
        consent_type: 'ai_processing',
        granted: false,
        version: 1,
        language: 'en',
      });
      expect(apiMock.post).toHaveBeenCalledWith('/screenings', expect.objectContaining({
        patient_id: 'patient-1',
      }));
      expect(apiMock.post).toHaveBeenCalledWith(
        '/screenings/screening-1/upload-image',
        expect.any(FormData),
        expect.any(Object),
      );
    });
    expect(await screen.findByText('Screening details opened')).toBeInTheDocument();
  });

  it('opens the live camera, captures a photo for quality review, and stops the camera', async () => {
    const stopTrack = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 1280,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => 720,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      callback(new Blob(['synthetic captured image'], { type }));
    });

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/screenings/new']}>
          <Routes>
            <Route element={<ScreeningWorkflowPage />} path="/screenings/new" />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Synthetic patient/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mouth ulcer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open live camera' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    }));
    expect(await screen.findByLabelText('Live oral photo camera preview')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Capture photo' }));
    expect(await screen.findByAltText('Screening images 1')).toBeInTheDocument();
    expect(screen.getByText('Photo looks ready to upload.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close live camera' }));
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it('explains when camera permission is denied', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(
          Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }),
        ),
      },
    });

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/screenings/new']}>
          <Routes>
            <Route element={<ScreeningWorkflowPage />} path="/screenings/new" />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Synthetic patient/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mouth ulcer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open live camera' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Camera permission was denied. Allow camera access in your browser settings and try again.',
    );
  });
});
