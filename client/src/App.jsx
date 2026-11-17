import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { AuthenticatedRedirect } from './routes/ProtectedRoute.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';
import RoleRoute from './routes/RoleRoute.jsx';
import AuthTimeout from './components/auth/AuthTimeout.jsx';
import WhatsAppContact from './components/WhatsAppContact.jsx';
import GlobalBackButton from './components/GlobalBackButton.jsx';


const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const PatientLoginPage = lazy(() => import('./pages/PatientLoginPage.jsx'));
const RegisterPage = lazy(() => import('./pages/RegisterPage.jsx'));
const PatientPublicRegistrationPage = lazy(() => import('./pages/PatientPublicRegistrationPage.jsx'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage.jsx'));
const FacilityDirectoryPage = lazy(() => import('./pages/FacilityDirectoryPage.jsx'));
const SuperAdminDashboardPage = lazy(() => import('./pages/SuperAdminDashboardPage.jsx'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage.jsx'));
const AdminRegistrationPage = lazy(() => import('./pages/AdminRegistrationPage.jsx'));
const AdminAuditPage = lazy(() => import('./pages/AdminAuditPage.jsx'));
const AdminReportsPage = lazy(() => import('./pages/AdminReportsPage.jsx'));
const RolePermissionsPage = lazy(() => import('./pages/RolePermissionsPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage.jsx'));
const PatientListPage = lazy(() => import('./pages/PatientListPage.jsx'));
const PatientRegistrationPage = lazy(() => import('./pages/PatientRegistrationPage.jsx'));
const PatientSyncPage = lazy(() => import('./pages/PatientSyncPage.jsx'));
const PatientProfilePage = lazy(() => import('./pages/PatientProfilePage.jsx'));
const PatientRecordsPage = lazy(() => import('./pages/PatientRecordsPage.jsx'));
const ResearchConsentPage = lazy(() => import('./pages/ResearchConsentPage.jsx'));
const HomePage = lazy(() => import('./pages/HomePage.jsx'));
const DiseaseDetailPage = lazy(() => import('./pages/DiseaseDetailPage.jsx'));
const ScreeningListPage = lazy(() => import('./pages/ScreeningListPage.jsx'));
const ScreeningWorkflowPage = lazy(() => import('./pages/ScreeningWorkflowPage.jsx'));
const ScreeningDetailPage = lazy(() => import('./pages/ScreeningDetailPage.jsx'));
const AppointmentBookingPage = lazy(() => import('./pages/AppointmentBookingPage.jsx'));
const AppointmentListPage = lazy(() => import('./pages/AppointmentListPage.jsx'));
const ReferralPage = lazy(() => import('./pages/ReferralPage.jsx'));
const MedicineReminderPage = lazy(() => import('./pages/MedicineReminderPage.jsx'));
const EmergencySosPage = lazy(() => import('./pages/EmergencySosPage.jsx'));
const LanguageSelectionPage = lazy(() => import('./pages/LanguageSelectionPage.jsx'));
const LanguageAssistantPage = lazy(() => import('./pages/LanguageAssistantPage.jsx'));
const VoiceSupportPage = lazy(() => import('./pages/VoiceSupportPage.jsx'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage.jsx'));
const ConsultationsPage = lazy(() => import('./pages/ConsultationsPage.jsx'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.jsx'));

function RegistrationEntry() {
  const location = useLocation();
  const type = new URLSearchParams(location.search).get('type');
  if (type === 'doctor') return <RegisterPage />;
  if (type === 'patient') return <PatientPublicRegistrationPage />;
  return <Navigate replace to="/login" />;
}

function LanguageGate({ children }) {
  const location = useLocation();
  const hasLanguage = typeof localStorage !== 'undefined'
    && Boolean(localStorage.getItem('aarogya-language'));
  if (!hasLanguage && location.pathname !== '/language') {
    return <Navigate replace state={{ from: location }} to="/language" />;
  }
  return children;
}

export default function App() {
  const { t } = useTranslation();
  return (
    <ToastProvider>
      <AuthProvider>
        <AuthTimeout />
        <WhatsAppContact />
        <GlobalBackButton />
        <LanguageGate>
        <Suspense fallback={<div className="route-loading" role="status" aria-label={t('loading')} />}>
        <Routes>
          <Route path="/language" element={<LanguageSelectionPage />} />
          <Route path="/" element={<HomePage />} />
          <Route path="/oral-diseases" element={<HomePage />} />
          <Route path="/diseases/:id" element={<DiseaseDetailPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/patient/login" element={<PatientLoginPage />} />
          <Route path="/patient/verify-otp" element={<LoginPage />} />
          <Route path="/patient/register" element={<PatientPublicRegistrationPage />} />
          <Route path="/register" element={<RegistrationEntry />} />
          <Route path="/admin-registration" element={<AdminRegistrationPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route element={<AppLayout />}>
              <Route
                path="notifications"
                element={<RoleRoute roles={['super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient']} permissions={['notifications:read']} />}
              >
                <Route index element={<NotificationsPage />} />
              </Route>
              <Route
                path="settings"
                element={<RoleRoute roles={['super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient']} permissions={['settings:read']} />}
              >
                <Route index element={<SettingsPage />} />
              </Route>
              <Route
                path="consultations"
                element={<RoleRoute roles={['super_admin', 'admin', 'doctor', 'patient']} permissions={['consultations:read']} />}
              >
                <Route index element={<ConsultationsPage />} />
              </Route>
              <Route
                path="analytics"
                element={<RoleRoute roles={['super_admin', 'admin', 'doctor']} permissions={['reports:read']} />}
              >
                <Route index element={<AnalyticsPage />} />
              </Route>
              <Route
                path="language-assistant"
                element={
                  <RoleRoute roles={['super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient']} permissions={['languages:use']} />
                }
              >
                <Route index element={<LanguageAssistantPage />} />
              </Route>
              <Route
                path="voice-support"
                element={
                  <RoleRoute roles={['super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient']} permissions={['voice:use']} />
                }
              >
                <Route index element={<VoiceSupportPage />} />
              </Route>
              <Route
                path="screenings"
                element={
                  <RoleRoute
                    permissions={['screenings:read']}
                    roles={[
                      'health_worker',
                      'doctor',
                      'specialist',
                      'admin',
                      'super_admin',
                      'patient',
                    ]}
                  />
                }
              >
                <Route index element={<ScreeningListPage />} />
              </Route>
              <Route
                path="screenings/new"
                element={<RoleRoute roles={['health_worker', 'doctor', 'patient']} permissions={['screenings:manage', 'screenings:self:manage']} />}
              >
                <Route index element={<ScreeningWorkflowPage />} />
              </Route>
              <Route
                path="screenings/:id"
                element={
                  <RoleRoute
                    permissions={['screenings:read']}
                    roles={[
                      'health_worker',
                      'doctor',
                      'specialist',
                      'admin',
                      'super_admin',
                      'patient',
                    ]}
                  />
                }
              >
                <Route index element={<ScreeningDetailPage />} />
              </Route>
              <Route
                path="appointments"
                element={
                  <RoleRoute roles={['super_admin', 'admin', 'doctor', 'health_worker', 'patient']} permissions={['appointments:read']} />
                }
              >
                <Route index element={<AppointmentListPage />} />
                <Route
                  path="book"
                  element={<RoleRoute roles={['patient', 'health_worker', 'admin', 'super_admin']} permissions={['appointments:manage']} />}
                >
                  <Route index element={<AppointmentBookingPage />} />
                </Route>
                <Route path="calendar" element={<RoleRoute roles={['doctor']} />}>
                  <Route index element={<AppointmentListPage />} />
                </Route>
              </Route>
              <Route
                path="referrals"
                element={
                  <RoleRoute
                    permissions={['referrals:read']}
                    roles={['super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient']}
                  />
                }
              >
                <Route index element={<ReferralPage />} />
              </Route>
              <Route
                path="medicines"
                element={<RoleRoute roles={['patient', 'doctor', 'health_worker']} permissions={['medicines:read']} />}
              >
                <Route index element={<MedicineReminderPage />} />
              </Route>
              <Route
                path="emergency"
                element={<RoleRoute roles={['patient', 'health_worker']} permissions={['emergency:use']} />}
              >
                <Route index element={<EmergencySosPage />} />
              </Route>
              <Route path="admin" element={<RoleRoute roles={['super_admin', 'admin']} permissions={['users:read']} />}>
                <Route index element={<AdminDashboardPage />} />
                <Route path="patients" element={<RoleRoute roles={['super_admin', 'admin']} permissions={['patients:read']} />}>
                  <Route index element={<PatientListPage />} />
                </Route>
                <Route path="patients/:id" element={<RoleRoute roles={['super_admin', 'admin']} permissions={['patients:read']} />}>
                  <Route index element={<PatientProfilePage />} />
                </Route>
                <Route path="users" element={<RoleRoute roles={['super_admin', 'admin']} permissions={['users:read']} />}>
                  <Route index element={<AdminUsersPage />} />
                </Route>
                <Route path="doctors" element={<RoleRoute roles={['super_admin', 'admin']} permissions={['users:read']} />}>
                  <Route index element={<AdminUsersPage doctorsOnly />} />
                </Route>
                <Route path="reports" element={<RoleRoute roles={['super_admin', 'admin']} permissions={['reports:read']} />}>
                  <Route index element={<AdminReportsPage />} />
                </Route>
                <Route path="audit-logs" element={<RoleRoute roles={['super_admin', 'admin']} permissions={['users:read']} />}>
                  <Route index element={<AdminAuditPage />} />
                </Route>
                <Route path="administrators" element={<RoleRoute roles={['super_admin']} permissions={['users:manage']} />}>
                  <Route index element={<AdminUsersPage administratorsOnly />} />
                </Route>
                <Route path="settings" element={<RoleRoute roles={['super_admin']} permissions={['settings:manage']} />}>
                  <Route index element={<SettingsPage />} />
                </Route>
                <Route path="roles" element={<RoleRoute roles={['super_admin']} permissions={['roles:manage']} />}>
                  <Route index element={<RolePermissionsPage />} />
                </Route>
              </Route>
              <Route path="super-admin" element={<RoleRoute roles={['super_admin']} permissions={['users:read']} />}>
                <Route index element={<SuperAdminDashboardPage />} />
                <Route path="facilities" element={<RoleRoute roles={['super_admin']} permissions={['users:read']} />}>
                  <Route index element={<FacilityDirectoryPage />} />
                </Route>
                <Route path="patients" element={<RoleRoute roles={['doctor', 'health_worker', 'specialist', 'admin', 'super_admin']} permissions={['patients:read']} />}>
                  <Route index element={<PatientListPage />} />
                </Route>
                  <Route path="patients/:id" element={<RoleRoute roles={['doctor', 'health_worker', 'specialist', 'admin', 'super_admin']} permissions={['patients:read']} />}>
                    <Route index element={<PatientProfilePage />} />
                  </Route>
                  <Route path="users" element={<RoleRoute roles={['super_admin']} permissions={['users:read']} />}>
                    <Route index element={<AdminUsersPage />} />
                  </Route>
                <Route path="doctors" element={<RoleRoute roles={['super_admin']} permissions={['users:read']} />}>
                  <Route index element={<AdminUsersPage doctorsOnly />} />
                </Route>
                <Route path="reports" element={<RoleRoute roles={['super_admin']} permissions={['reports:read']} />}>
                  <Route index element={<AdminReportsPage />} />
                </Route>
                <Route path="audit-logs" element={<RoleRoute roles={['super_admin']} permissions={['users:read']} />}>
                  <Route index element={<AdminAuditPage />} />
                </Route>
                <Route path="administrators" element={<RoleRoute roles={['super_admin']} permissions={['users:manage']} />}>
                  <Route index element={<AdminUsersPage administratorsOnly />} />
                </Route>
                <Route path="settings" element={<RoleRoute roles={['super_admin']} permissions={['settings:manage']} />}>
                  <Route index element={<SettingsPage />} />
                </Route>
                <Route path="roles" element={<RoleRoute roles={['super_admin']} permissions={['roles:manage']} />}>
                  <Route index element={<RolePermissionsPage />} />
                </Route>
              </Route>
              <Route path="doctor" element={<RoleRoute roles={['doctor']} />}>
                <Route index element={<DashboardPage />} />
              </Route>
              <Route path="health-worker" element={<RoleRoute roles={['health_worker']} />}>
                <Route index element={<DashboardPage />} />
                <Route path="sync-status" element={<PatientSyncPage />} />
              </Route>
              <Route path="specialist" element={<RoleRoute roles={['specialist']} />}>
                <Route index element={<DashboardPage />} />
              </Route>
              <Route path="patient" element={<RoleRoute roles={['patient']} />}>
                <Route index element={<DashboardPage />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="records" element={<PatientRecordsPage />} />
                <Route path="research-consent" element={<ResearchConsentPage />} />
              </Route>
              <Route
                path="patients"
                element={
                  <RoleRoute
                    roles={['doctor', 'health_worker', 'specialist', 'admin', 'super_admin']}
                    permissions={['patients:read']}
                  />
                }
              >
                <Route index element={<PatientListPage />} />
                <Route
                  path="sync-status"
                  element={<RoleRoute roles={['health_worker', 'doctor', 'admin']} permissions={['patients:manage']} />}
                >
                  <Route index element={<PatientSyncPage />} />
                </Route>
                <Route
                  path="register"
                  element={<RoleRoute roles={['health_worker', 'admin', 'super_admin']} permissions={['patients:manage']} />}
                >
                  <Route index element={<PatientRegistrationPage />} />
                </Route>
                <Route path=":id" element={<RoleRoute roles={['doctor', 'health_worker', 'specialist', 'admin', 'super_admin']} permissions={['patients:read']} />}>
                  <Route index element={<PatientProfilePage />} />
                </Route>
              </Route>
              <Route path="*" element={<AuthenticatedRedirect />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
        </Suspense>
        </LanguageGate>
      </AuthProvider>
    </ToastProvider>
  );
}
