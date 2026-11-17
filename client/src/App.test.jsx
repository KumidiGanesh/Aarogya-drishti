import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authState = vi.hoisted(() => ({ user: null, logout: vi.fn() }));
const apiMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('./auth/AuthContext.jsx', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: authState.user,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: authState.logout,
    refresh: vi.fn(),
  }),
}));
vi.mock('./services/api.js', () => ({ default: apiMock }));

import App from './App.jsx';
import api from './services/api.js';

describe('application authentication and role routes', () => {
  beforeEach(() => {
    authState.user = null;
    localStorage.setItem('aarogya-language', 'en');
    vi.clearAllMocks();
  });

  it('requires a first-run language choice before showing other routes', async () => {
    localStorage.clear();
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Choose your language' })).toBeInTheDocument();
    expect(document.querySelectorAll('.language-option')).toHaveLength(4);
  });

  it('links the public home page to the existing protected Language Assistant', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: /Open Language Assistant/ }))
      .toHaveAttribute('href', '/language-assistant');
  });

  it('renders patient, doctor, and admin sign-in options for anonymous users', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Doctor Login' })).toBeInTheDocument();
    expect(screen.getByLabelText('Registered email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Patient Login' }));
    expect(screen.getByLabelText('Indian mobile number')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Doctor Login' }));
    expect(await screen.findByRole('heading', { name: 'Doctor Login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Doctor Login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin Login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Patient Login' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create a patient account' })).not.toBeInTheDocument();
  });

  it('does not expose patient self-registration', async () => {
    render(
      <MemoryRouter initialEntries={['/register']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Doctor Login' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Patient registration' })).not.toBeInTheDocument();
  });

  it('shows the patient registration page at its direct route', async () => {
    render(
      <MemoryRouter initialEntries={['/patient/register']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Patient registration' })).toBeInTheDocument();
    expect(screen.getByLabelText('Indian mobile number')).toBeInTheDocument();
  });

  it('redirects doctors away from staff patient registration', async () => {
    authState.user = {
      id: 'doctor-demo',
      full_name: 'Demo Doctor',
      role: 'doctor',
      permissions: ['patients:read', 'patients:manage'],
    };
    apiMock.get.mockResolvedValue({ data: { data: { items: [] }, meta: { total: 0 } } });

    render(
      <MemoryRouter initialEntries={['/patients/register']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome back, Dr. Demo Doctor!' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Patient registration' })).not.toBeInTheDocument();
  });

  it('redirects doctors away from patient appointment booking', async () => {
    authState.user = {
      id: 'doctor-demo',
      full_name: 'Demo Doctor',
      role: 'doctor',
      permissions: ['appointments:read', 'appointments:manage'],
    };
    apiMock.get.mockResolvedValue({ data: { data: { items: [] }, meta: { total: 0 } } });

    render(
      <MemoryRouter initialEntries={['/appointments/book']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome back, Dr. Demo Doctor!' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Book an appointment' })).not.toBeInTheDocument();
  });

  it('opens password-based patient login from its dedicated route', async () => {
    render(
      <MemoryRouter initialEntries={['/patient/login']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Patient Login' })).toBeInTheDocument();
    expect(screen.getByLabelText('Indian mobile number')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create New Account' })).toHaveAttribute(
      'href',
      '/patient/register',
    );
  });

  it('opens the six-digit OTP screen when the patient challenge route has valid state', async () => {
    render(
      <MemoryRouter
        initialEntries={[{
          pathname: '/patient/verify-otp',
          state: {
            challengeId: 'a'.repeat(36),
            mobile: '9876543210',
            expiresAt: Date.now() + 300_000,
            resendAt: Date.now() + 30_000,
          },
        }]}
      >
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('Verification code digit 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Verification code digit 6')).toBeInTheDocument();
  });

  it('sends direct OTP-route visits without a challenge back to patient login', async () => {
    render(
      <MemoryRouter initialEntries={['/patient/verify-otp']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Patient Login' })).toBeInTheDocument();
    expect(screen.getByLabelText('Indian mobile number')).toBeInTheDocument();
  });

  it('accepts the patient dashboard destination used after self-registration', async () => {
    authState.user = {
      id: 'patient-demo',
      full_name: 'Demo Patient',
      role: 'patient',
    };
    apiMock.get.mockResolvedValue({ data: { data: { user: { profile: { id: 'patient-demo' } } } } });

    render(
      <MemoryRouter initialEntries={['/patient/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome, Demo Patient' })).toBeInTheDocument();
  });

  it('renders the patient sidebar links, active route, unread count, and existing logout action', async () => {
    authState.user = {
      id: 'patient-demo',
      full_name: 'Ram',
      role: 'patient',
      permissions: [
        'patients:read',
        'patients:self:manage',
        'screenings:self:manage',
        'screenings:read',
        'appointments:read',
        'referrals:read',
        'medicines:read',
        'emergency:use',
        'languages:use',
        'voice:use',
        'notifications:read',
        'consultations:read',
        'settings:read',
      ],
    };
    apiMock.get.mockImplementation((path) => Promise.resolve({
      data: {
        data: path === '/notifications'
          ? { unread_count: 3 }
          : { user: { profile: {} } },
      },
    }));

    render(
      <MemoryRouter initialEntries={['/patient/records']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: /My health records/ });
    const sidebar = document.querySelector('.sidebar');
    expect(sidebar).toBeInTheDocument();
    const destinations = [
      ['/patient/records', /My health records/],
      ['/patient/research-consent', /Research consent/],
      ['/screenings/new', /Start a screening/],
      ['/screenings', /^Screenings$/],
      ['/appointments', /^Appointments$/],
      ['/referrals', /^Referrals$/],
      ['/medicines', /Medicine reminders/],
      ['/emergency', /Emergency/],
      ['/language-assistant', /AI Language Assistant/],
      ['/voice-support', /Voice support/i],
      ['/notifications', /Notifications/],
      ['/consultations', /Telemedicine/],
      ['/settings', /^Settings$/],
      ['/patient', /^Dashboard$/],
    ];
    for (const [destination, label] of destinations) {
      expect(within(sidebar).getByRole('link', { name: label })).toHaveAttribute('href', destination);
    }

    expect(within(sidebar).getByRole('link', { name: /My health records/ })).toHaveClass('nav-link--active');
    expect(await within(sidebar).findByLabelText('3 unread notifications')).toHaveTextContent('3');
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Sign out' }));
    expect(authState.logout).toHaveBeenCalledOnce();
  });

  it('shows the public landing page at the root for an authenticated patient', async () => {
    authState.user = {
      id: 'patient-demo',
      full_name: 'Demo Patient',
      role: 'patient',
    };

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'AAROGYA DRISHTI ITDA PADERU' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Login' })[0]).toHaveAttribute('href', '/login');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the home landing page with featured information and staff sign-in', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'AAROGYA DRISHTI ITDA PADERU' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Start with everyday oral health' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Explore all 24 topics' })).toHaveAttribute(
      'href',
      '/oral-diseases',
    );
    expect(screen.getByRole('heading', { name: 'For doctors and administrators' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Staff sign in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('allows patients into their dashboard without opening the admin dashboard', async () => {
    authState.user = {
      id: 'patient-demo',
      full_name: 'Demo Patient',
      role: 'patient',
    };

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome, Demo Patient' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin Dashboard' })).not.toBeInTheDocument();
  });

  it('renders all 24 oral health cards, their safety banners, and search results', async () => {
    render(
      <MemoryRouter initialEntries={['/oral-diseases']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findAllByRole('article')).toHaveLength(24);
    expect(
      screen.getAllByText(
        'Educational information only. This is not a diagnosis. Please consult a qualified doctor.',
      ),
    ).toHaveLength(25);
    expect(screen.getAllByRole('img')).toHaveLength(24);
    expect(document.querySelectorAll('[data-disease-motif]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-clinical-photo]')).toHaveLength(22);
    expect(
      new Set(
        [...document.querySelectorAll('[data-disease-motif]')].map((image) =>
          image.getAttribute('data-disease-motif'),
        ),
      ),
    ).toHaveProperty('size', 2);
    expect(screen.getByRole('link', { name: 'View More: Oral Cancer' })).toHaveAttribute(
      'href',
      '/diseases/oral-cancer',
    );

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'oral cancer' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Oral Cancer' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by category' }), {
      target: { value: 'gum_teeth' },
    });
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('opens the oral diseases catalog as its own page from the home feature button', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('link', { name: 'Screening' }));

    expect(await screen.findByRole('heading', { name: 'Oral Cavity Diseases' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(24);
    expect(
      screen.queryByRole('heading', { name: 'Care and support, made more accessible' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AAROGYA DRISHTI ITDA PADERU' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('serves a disease detail page with safety information and a doctor call to action', async () => {
    render(
      <MemoryRouter initialEntries={['/diseases/oral-cancer']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Oral Cancer' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Any non-healing ulcer or white/red patch lasting more than 2 weeks needs a doctor visit. Seek prompt care for a new lump or difficulty swallowing.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listen to a short summary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book Appointment / Find a Doctor' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('shows a sourced, openly licensed reference photo for oral leukoplakia', async () => {
    render(
      <MemoryRouter initialEntries={['/diseases/oral-leukoplakia']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('img', {
        name: 'Reference image for Oral Leukoplakia. Educational only, not for diagnosis.',
      }),
    ).toHaveAttribute('data-clinical-photo', 'oral-leukoplakia');
    expect(
      screen.getByRole('link', {
        name: 'Photo credit: National Cancer Institute; photographer unknown — Public domain',
      }),
    ).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Leukoplakia.jpg');
    expect(screen.getByText('Clinical reference photo — not diagnostic')).toBeInTheDocument();
  });

  it('shows sourced clinical photos for common oral conditions', async () => {
    render(
      <MemoryRouter initialEntries={['/oral-diseases']}>
        <App />
      </MemoryRouter>,
    );

    const photoIds = [
      'oral-cancer',
      'gingivitis',
      'tooth-decay',
      'oral-thrush',
      'oral-candidiasis',
      'mouth-ulcers',
      'periodontitis',
      'geographic-tongue',
      'oral-lichen-planus',
      'dental-abscess',
      'cold-sores',
      'angular-cheilitis',
      'oral-herpes',
      'oral-erythroplakia',
      'proliferative-verrucous-leukoplakia',
      'actinic-cheilitis',
      'oral-lichenoid-lesions',
      'oral-lupus-erythematosus',
      'smokeless-tobacco-keratosis',
      'oral-hairy-leukoplakia',
    ];
    for (const id of photoIds) {
      expect(document.querySelector(`[data-clinical-photo="${id}"]`)).toBeInTheDocument();
    }

    expect(
      screen.getByRole('link', {
        name: 'Photo credit: Dr. Yogesh — CC BY-SA 4.0',
      }),
    ).toHaveAttribute(
      'href',
      'https://commons.wikimedia.org/wiki/File:Dental_Caries_Lower_Left_First_Molar_01.jpg',
    );
    expect(
      screen.getByRole('link', {
        name: 'Photo credit: Centers for Disease Control and Prevention (CDC) — Public domain',
      }),
    ).toHaveAttribute(
      'href',
      'https://commons.wikimedia.org/wiki/File:Oral_thrush_Aphthae_Candida_albicans._PHIL_1217_lores.jpg',
    );
    expect(
      screen.getByRole('link', { name: 'Photo credit: Jenny Öhman et al. — CC BY 4.0' }),
    ).toHaveAttribute('href', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10644603/');
  });
});
