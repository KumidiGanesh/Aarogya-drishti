import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { ToastProvider } from '../components/ui/Toast.jsx';
import AppLayout from '../layouts/AppLayout.jsx';
import AdminDashboardPage from './AdminDashboardPage.jsx';
import AdminUsersPage from './AdminUsersPage.jsx';
import PatientListPage from './PatientListPage.jsx';

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  user: {
    role: 'super_admin',
    id: 'demo-admin',
    full_name: 'Demo Admin',
    permissions: ['patients:read', 'patients:manage', 'users:read', 'users:manage', 'reports:read', 'settings:manage'],
  },
}));

vi.mock('../services/api.js', () => ({ default: mockApi }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => authState }));
vi.mock('recharts', () => ({
  Bar: () => null,
  BarChart: ({ children }) => <div>{children}</div>,
  Cell: () => null,
  CartesianGrid: () => null,
  Line: () => null,
  LineChart: ({ children }) => <div>{children}</div>,
  Pie: ({ children }) => <div>{children}</div>,
  PieChart: ({ children }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const dashboardData = {
  totalPatients: 10,
  totalDoctors: 5,
  totalScreenings: 22,
  pendingScreeningReviews: 4,
  totalHealthWorkers: 5,
  totalSpecialists: 3,
  totalHospitals: 4,
  totalAppointments: 7,
  pendingReferrals: 2,
  completedConsultations: 3,
  emergencyRequests: 1,
  recentRegistrations: [
    {
      id: 'patient-1',
      patient_code: 'AD-2026-000001',
      full_name: 'Demo Patient',
      village_name: 'Demo Village',
      phc_name: 'Demo PHC',
      created_at: '2026-10-30T00:00:00Z',
    },
  ],
  auditLogs: [
    {
      id: 'audit-1',
      action: 'admin.doctor.registration_approved',
      entity: 'users',
      user_name: 'Demo Admin',
      created_at: '2026-10-30T00:00:00Z',
    },
  ],
  kpis: {
    totalPatients: { value: 10, changePercent: 12, trend: [1, 2, 1, 3] },
    totalDoctors: { value: 5, changePercent: 4, trend: [1, 1, 2, 2] },
    totalScreenings: { value: 22, changePercent: 9, trend: [2, 4, 3, 5] },
    pendingScreeningReviews: { value: 4, changePercent: -3, trend: [2, 1, 2, 1] },
  },
  userRoleDistribution: { patient: 10, doctor: 5, admin: 1 },
  screeningTrend: [{ month: '2026-10', screenings: 8 }],
  facilityScreeningCounts: [{ name: 'Demo Clinic', screenings: 8 }],
  registrationTrend: { days7: [], days30: [] },
};

function renderWithProviders(component, initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ToastProvider>{component}</ToastProvider>
    </MemoryRouter>,
  );
}

describe('admin dashboard and user-management screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      role: 'super_admin',
      id: 'demo-admin',
      full_name: 'Demo Admin',
      permissions: ['patients:read', 'patients:manage', 'users:read', 'users:manage', 'reports:read', 'settings:manage'],
    };
    mockApi.get.mockImplementation((path) => {
      if (path === '/admin/dashboard') return Promise.resolve({ data: { data: dashboardData } });
      if (path === '/admin/audit-logs') {
        return Promise.resolve({ data: { data: { items: dashboardData.auditLogs } } });
      }
      if (path === '/appointments') {
        return Promise.resolve({ data: { data: { directory: { hospitals: [], phcs: [] } } } });
      }
      if (path === '/admin/users') {
        return Promise.resolve({
          data: {
            data: {
              items: [
                {
                  id: 'user-1',
                  full_name: 'Demo Doctor',
                  mobile: '9876543210',
                  role: 'doctor',
                  is_active: true,
                  created_at: '2026-10-30T00:00:00Z',
                },
              ],
            },
            meta: { page: 1, totalPages: 1 },
          },
        });
      }
      return Promise.reject(new Error('Unexpected request'));
    });
  });

  it('shows live dashboard metrics, recent registrations, audit activity, quick links, and district filter', async () => {
    renderWithProviders(<AdminDashboardPage />);

    expect(await screen.findByRole('heading', { name: 'Admin dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Total registered patients')).toBeInTheDocument();
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.getByText('Demo Patient')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by district')).toBeInTheDocument();
    expect(await screen.findByText('admin doctor registration approved')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Resource ID' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actor' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Total doctors/ })).toHaveAttribute('href', '/super-admin/doctors');
    expect(screen.getAllByRole('link', { name: /View all/ })[0]).toHaveAttribute(
      'href',
      '/super-admin/audit-logs',
    );
    expect(mockApi.get).toHaveBeenCalledWith(
      '/admin/audit-logs',
      { params: { page: 1, limit: 5 } },
    );
  });

  it('uses the wide admin workspace shell and user search for super administrators', async () => {
    mockApi.get.mockResolvedValue({ data: { data: { unread_count: 0 } } });
    renderWithProviders(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/super-admin" element={<p>Super Admin content</p>} />
        </Route>
      </Routes>,
      ['/super-admin'],
    );

    expect(await screen.findByText('Super Admin content')).toBeInTheDocument();
    expect(document.querySelector('.app-shell--admin')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search name, mobile, or email' })).toBeInTheDocument();
  });

  it('shows data-backed role and facility insights with working administrative actions', async () => {
    renderWithProviders(<AdminDashboardPage />);

    expect(await screen.findByRole('heading', { name: 'User and patient distribution' })).toBeInTheDocument();
    expect(screen.getByText('Demo Clinic')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add patient' })).toHaveAttribute('href', '/patients/register');
    expect(screen.getByRole('link', { name: 'Add doctor' })).toHaveAttribute('href', '/super-admin/doctors');
    expect(screen.getByRole('link', { name: 'View screening reports' })).toHaveAttribute('href', '/super-admin/reports');
    expect(screen.getByText(/\+12%/)).toBeInTheDocument();
  });

  it('loads the user table and opens the add-user form', async () => {
    renderWithProviders(<AdminUsersPage />);

    expect(await screen.findByText('Demo Doctor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    expect(await screen.findByRole('heading', { name: 'Create user' })).toBeInTheDocument();
    expect(screen.getByLabelText('Initial password')).toBeInTheDocument();
  });

  it('applies the global admin search query to the user directory', async () => {
    renderWithProviders(<AdminUsersPage />, ['/admin/users?search=Demo%20Doctor']);

    expect(await screen.findByText('Demo Doctor')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith(
      '/admin/users',
      expect.objectContaining({ params: expect.objectContaining({ search: 'Demo Doctor' }) }),
    );
  });

  it('shows a doctor-only registration flow in doctor management', async () => {
    renderWithProviders(<AdminUsersPage doctorsOnly />);

    expect(await screen.findByRole('heading', { name: 'Doctors' })).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith(
      '/admin/users',
      expect.objectContaining({ params: expect.objectContaining({ role: 'doctor' }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Register doctor' }));

    expect(await screen.findByRole('heading', { name: 'Register doctor' })).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toHaveValue('doctor');
    expect(screen.getByLabelText('Role')).toBeDisabled();
  });

  it('lets an administrator assign facilities and save real weekly doctor slots', async () => {
    const hospitalId = 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce';
    const phcId = 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce';
    mockApi.get.mockImplementation((path) => {
      if (path === '/appointments') {
        return Promise.resolve({
          data: { data: { directory: {
            hospitals: [{ id: hospitalId, name: 'Assigned Hospital' }],
            phcs: [{ id: phcId, name: 'Assigned PHC' }],
          } } },
        });
      }
      if (path === '/admin/users/user-1') {
        return Promise.resolve({
          data: { data: {
            id: 'user-1',
            full_name: 'Demo Doctor',
            mobile: '9876543210',
            role: 'doctor',
            preferred_language: 'en',
            is_active: true,
            profile: {
              registration_number: 'REG-1',
              hospital_id: hospitalId,
              phc_id: phcId,
              availability: { '1': ['09:00'] },
            },
          } },
        });
      }
      if (path === '/admin/users') {
        return Promise.resolve({
          data: {
            data: { items: [{ id: 'user-1', full_name: 'Demo Doctor', mobile: '9876543210', role: 'doctor', is_active: true }] },
            meta: { page: 1, totalPages: 1 },
          },
        });
      }
      return Promise.reject(new Error('Unexpected request'));
    });
    mockApi.put.mockResolvedValue({ data: { data: { user: { id: 'user-1' } } } });

    renderWithProviders(<AdminUsersPage doctorsOnly />);
    await screen.findByText('Demo Doctor');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Demo Doctor' }));

    const monday = await screen.findByLabelText('Monday');
    expect(monday).toHaveValue('09:00');
    fireEvent.change(monday, { target: { value: '10:00, 10:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith(
      '/admin/users/user-1',
      expect.objectContaining({
        profile: expect.objectContaining({
          hospital_id: hospitalId,
          phc_id: phcId,
          availability: { '1': ['10:00', '10:30'] },
        }),
      }),
    ));
  });

  it('creates an administrator with a unique ID and matching confirmation password', async () => {
    mockApi.post.mockResolvedValue({
      data: { data: { id: 'new-admin', full_name: 'Synthetic Admin' } },
    });
    renderWithProviders(<AdminUsersPage administratorsOnly />);
    await screen.findByText('Demo Doctor');
    fireEvent.click(screen.getByRole('button', { name: 'Create Admin Account' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Synthetic Admin' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543211' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.test' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin007' } });
    fireEvent.change(screen.getByLabelText('Admin ID'), { target: { value: 'ADMIN-007' } });
    fireEvent.change(screen.getByLabelText('Initial password'), { target: { value: 'StrongPass1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'StrongPass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith(
        '/admin/users',
        expect.objectContaining({
          email: 'admin@example.test',
          role: 'admin',
          username: 'admin007',
          admin_id: 'ADMIN-007',
          confirm_password: 'StrongPass1',
        }),
      ),
    );
  });

  it('lets super admins register patients from the patient list', async () => {
    mockApi.get.mockResolvedValueOnce({
      data: { data: { items: [] }, meta: { page: 1, totalPages: 1 } },
    });

    renderWithProviders(<PatientListPage />);

    expect(await screen.findByRole('link', { name: 'Register patient' })).toHaveAttribute(
      'href',
      '/patients/register',
    );
  });

  it('shows assigned patients to doctors without a registration action', async () => {
    authState.user = {
      ...authState.user,
      role: 'doctor',
      permissions: ['patients:read'],
    };
    mockApi.get.mockResolvedValueOnce({
      data: {
        data: {
          items: [{
            id: 'assigned-patient-1',
            patient_code: 'AD-2026-000001',
            full_name: 'Assigned Patient',
            mobile: '9000000000',
            village_name: 'Demo Village',
            district: 'Demo District',
          }],
        },
        meta: { page: 1, totalPages: 1 },
      },
    });

    renderWithProviders(<PatientListPage />);

    expect(await screen.findByRole('heading', { name: 'My Patients' })).toBeInTheDocument();
    expect(screen.getByText('Assigned Patient')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Register patient' })).not.toBeInTheDocument();
  });

  it('submits the role and profile information when creating a doctor', async () => {
    mockApi.post.mockResolvedValue({
      data: { data: { id: 'new-user', full_name: 'Synthetic Doctor' } },
    });
    renderWithProviders(<AdminUsersPage />);
    await screen.findByText('Demo Doctor');
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Synthetic Doctor' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543211' } });
    fireEvent.change(screen.getByLabelText('Initial password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.change(screen.getByLabelText('Registration number'), {
      target: { value: 'DEMO-DOC-900' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith(
        '/admin/users',
        expect.objectContaining({
          full_name: 'Synthetic Doctor',
          role: 'doctor',
          profile: expect.objectContaining({ registration_number: 'DEMO-DOC-900' }),
        }),
      ),
    );
  });

  it('lets an administrator approve a pending doctor request', async () => {
    mockApi.get.mockImplementation((path) => {
      if (path === '/admin/users') {
        return Promise.resolve({
          data: {
            data: {
              items: [{
                id: 'pending-doctor',
                full_name: 'Pending Doctor',
                mobile: '9876543210',
                role: 'doctor',
                is_active: false,
                pending_approval: true,
                created_at: '2026-10-30T00:00:00Z',
              }],
            },
            meta: { page: 1, totalPages: 1 },
          },
        });

        it('lets only the Super Admin workflow approve a pending administrator', async () => {
          mockApi.get.mockImplementation((path) => {
            if (path === '/admin/users') {
              return Promise.resolve({
                data: {
                  data: {
                    items: [{
                      id: 'pending-admin',
                      full_name: 'Pending Admin',
                      mobile: '9876543210',
                      role: 'admin',
                      admin_id: 'ADMIN-008',
                      is_active: false,
                      pending_approval: true,
                      admin_registration_status: 'pending',
                      created_at: '2026-10-30T00:00:00Z',
                    }],
                  },
                  meta: { page: 1, totalPages: 1 },
                },
              });
            }
            return Promise.reject(new Error('Unexpected request'));
          });
          mockApi.put.mockResolvedValue({ data: { data: {} } });

          renderWithProviders(<AdminUsersPage administratorsOnly />);
          fireEvent.click(await screen.findByRole('button', {
            name: 'Approve administrator account for Pending Admin',
          }));

          await waitFor(() =>
            expect(mockApi.put).toHaveBeenCalledWith(
              '/admin/users/pending-admin/admin-registration',
              { decision: 'approved' },
            ),
          );
        });
      }
      return Promise.reject(new Error('Unexpected request'));
    });
    mockApi.put.mockResolvedValue({ data: { data: {} } });

    renderWithProviders(<AdminUsersPage />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Approve doctor account for Pending Doctor',
    }));

    await waitFor(() =>
      expect(mockApi.put).toHaveBeenCalledWith(
        '/admin/users/pending-doctor/doctor-registration',
        { decision: 'approved' },
      ),
    );
  });

  it('lets an administrator reject a pending doctor request', async () => {
    mockApi.get.mockImplementation((path) => {
      if (path === '/admin/users') {
        return Promise.resolve({
          data: {
            data: {
              items: [{
                id: 'pending-doctor',
                full_name: 'Pending Doctor',
                mobile: '9876543210',
                role: 'doctor',
                is_active: false,
                pending_approval: true,
                doctor_request_status: 'pending',
                created_at: '2026-10-30T00:00:00Z',
              }],
            },
            meta: { page: 1, totalPages: 1 },
          },
        });
      }
      return Promise.reject(new Error('Unexpected request'));
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi.put.mockResolvedValue({ data: { data: {} } });

    renderWithProviders(<AdminUsersPage />);
    fireEvent.click(await screen.findByRole('button', {
      name: 'Reject doctor account for Pending Doctor',
    }));

    await waitFor(() =>
      expect(mockApi.put).toHaveBeenCalledWith(
        '/admin/users/pending-doctor/doctor-registration',
        { decision: 'rejected' },
      ),
    );
  });
});
