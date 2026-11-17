import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast.jsx';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const authState = vi.hoisted(() => ({ user: { role: 'patient', full_name: 'Synthetic patient' } }));
vi.mock('../services/api.js', () => ({ default: apiMock }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));

import ScreeningDetailPage from './ScreeningDetailPage.jsx';

describe('screening detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          screening: {
            id: 'screening-1',
            status: 'ai_completed',
            created_at: '2026-10-31T12:00:00.000Z',
            patient: {
              full_name: 'Synthetic patient',
              patient_code: 'AD-2026-000001',
              village_name: 'Demo Village',
            },
            patient_history: null,
            symptoms: [],
            images: [],
            clinical_reviews: [],
            referrals: [],
            ai_result: {
              risk_category: null,
              confidence: null,
              inference_status: 'not_performed',
              is_demo: true,
              disclaimer: 'DEMO AI OUTPUT – NOT FOR CLINICAL USE.',
              result_data: {
                analysis_status: 'demonstration_only',
                image_analyzed: false,
                visible_observations: [],
                findings: 'Features that may need clinical attention.',
                safety_sentence:
                  'This tool does not diagnose and does not replace professional medical evaluation.',
              },
            },
          },
        },
      },
    });
  });

  it('displays the exact demonstration banners and safety text with AI output', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/screenings/screening-1']}>
          <Routes>
            <Route element={<ScreeningDetailPage />} path="/screenings/:id" />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(await screen.findByText('DEMO AI OUTPUT – NOT FOR CLINICAL USE.')).toBeInTheDocument();
    expect(screen.getByText('DEMONSTRATION OUTPUT – IMAGES WERE NOT ANALYZED')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This tool does not diagnose and does not replace professional medical evaluation.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Features that may need clinical attention.')).toBeInTheDocument();
  });

  it('shows screening identity, reported symptom details, and real review state', async () => {
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          screening: {
            id: 'screening-reference-42',
            created_at: '2026-10-31T12:00:00.000Z',
            patient: {
              full_name: 'Synthetic patient',
              patient_code: 'AD-2026-000001',
            },
            patient_history: null,
            symptoms: [{
              id: 'symptom-1',
              symptom_code: 'mouth_ulcer',
              severity: 'moderate',
              duration_days: 3,
            }],
            images: [],
            doctor_request: {
              status: 'submitted',
              doctor_name: 'Demo Doctor',
            },
            clinical_reviews: [],
            referrals: [],
            ai_result: null,
          },
        },
      },
    });

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/screenings/screening-reference-42']}>
          <Routes>
            <Route element={<ScreeningDetailPage />} path="/screenings/:id" />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(await screen.findByText(/Oral screening: screening-reference-42/)).toBeInTheDocument();
    expect(screen.getByText('Mouth ulcer')).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    expect(screen.getByText(/3 Duration in days/)).toBeInTheDocument();
    expect(screen.getByText('Request submitted')).toBeInTheDocument();
  });

  it('renders image inference separately from symptoms without a medical risk score', async () => {
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          screening: {
            id: 'screening-1',
            status: 'ai_completed',
            created_at: '2026-10-31T12:00:00.000Z',
            ai_provider_configured: true,
            ai_processing_consent_granted: true,
            patient: { full_name: 'Synthetic patient', patient_code: 'AD-2026-000001' },
            patient_history: null,
            symptoms: [],
            images: [],
            clinical_reviews: [],
            referrals: [],
            ai_result: {
              risk_category: null,
              confidence: null,
              inference_status: 'completed',
              model_provider: 'Gemini',
              model_version: 'gemini-test',
              is_demo: false,
              result_data: {
                analysis_status: 'completed',
                image_analyzed: true,
                oral_region_detected: true,
                image_limitations: [],
                uncertainty: ['General-purpose model; not clinically validated.'],
                medical_limitations:
                  'Gemini is not clinically validated for oral disease screening.',
                image_quality: {
                  status: 'adequate',
                  concerns: [],
                  explanation: 'Image is clear enough for preliminary review.',
                },
                visible_observations: [
                  {
                    type: 'white_area',
                    location: 'inner cheek',
                    description: 'Visible white area; clinical examination is required.',
                  },
                ],
                reported_symptoms: [
                  { code: 'mouth_ulcer', severity: 'moderate', duration_days: 5 },
                ],
                explanation: 'Prompt evaluation is appropriate.',
                recommended_next_steps: ['Arrange qualified clinical evaluation.'],
              },
            },
          },
        },
      },
    });
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/screenings/screening-1']}>
          <Routes>
            <Route element={<ScreeningDetailPage />} path="/screenings/:id" />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Image inference completed')).toBeInTheDocument();
    expect(screen.getByText(/Model provider: Gemini \(gemini-test\)/)).toBeInTheDocument();
    expect(screen.getByText('Image quality')).toBeInTheDocument();
    expect(screen.getByText('Visible observations')).toBeInTheDocument();
    expect(
      screen.getByText(/Visible white area; clinical examination is required/),
    ).toBeInTheDocument();
    expect(screen.getByText('Reported symptoms')).toBeInTheDocument();
    expect(screen.getByText('Arrange qualified clinical evaluation.')).toBeInTheDocument();
    expect(
      screen.getByText(/Gemini is not clinically validated for oral disease screening/),
    ).toBeInTheDocument();
    expect(screen.getByText(/General-purpose model; not clinically validated/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Risk category|Risk score|Urgent Clinical Evaluation/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Simulated demonstration score/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DEMO AI OUTPUT/)).not.toBeInTheDocument();
  });

  it('lets a patient grant Gemini consent from their screening report', async () => {
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          screening: {
            id: 'screening-1',
            ai_provider_configured: true,
            ai_processing_consent_granted: false,
            ai_processing_consent_version: 2,
            patient: { id: 'patient-1', full_name: 'Synthetic patient' },
            patient_history: null,
            symptoms: [],
            images: [],
            clinical_reviews: [],
            referrals: [],
            ai_result: null,
          },
        },
      },
    });

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/screenings/screening-1']}>
          <Routes>
            <Route element={<ScreeningDetailPage />} path="/screenings/:id" />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Allow Gemini processing' }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/patients/patient-1/consent', {
        consent_type: 'ai_processing',
        granted: true,
        version: 2,
        language: 'en',
      }),
    );
  });

  it('labels failed inference as unavailable and does not show observations', async () => {
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          screening: {
            id: 'screening-1',
            status: 'analysis_failed',
            patient: { full_name: 'Synthetic patient' },
            patient_history: null,
            symptoms: [],
            images: [],
            clinical_reviews: [],
            referrals: [],
            ai_result: {
              inference_status: 'failed',
              is_demo: false,
              risk_category: null,
              confidence: null,
              result_data: {
                analysis_status: 'unavailable',
                image_analyzed: false,
                visible_observations: [],
                reported_symptoms: [],
              },
            },
          },
        },
      },
    });
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/screenings/screening-1']}>
          <Routes>
            <Route element={<ScreeningDetailPage />} path="/screenings/:id" />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(await screen.findByText('NO IMAGE-BASED RESULT WAS GENERATED.')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Image inference did not complete')).toBeInTheDocument();
    expect(screen.queryByText('Low Risk')).not.toBeInTheDocument();
  });
});
