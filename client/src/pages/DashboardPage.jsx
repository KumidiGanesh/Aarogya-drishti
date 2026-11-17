import { ArrowUpRight, HeartPulse } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { roleDashboardPath } from '../auth/roles.js';
import { sidebarMenu } from '../layouts/sidebarMenu.js';
import DoctorDashboardPage from './DoctorDashboardPage.jsx';
import PatientDashboardOverview from './PatientDashboardOverview.jsx';

const quickLinksByRole = {
  patient: [
    'screening.start',
    'patient.myRecords',
    'screening.list',
    'phase8.appointmentsTitle',
    'phase9.medicineTitle',
    'phase9.emergencyTitle',
    'phase10.assistantTitle',
  ],
  health_worker: [
    'patient.register',
    'patient.list',
    'patient.syncStatus',
    'screening.list',
    'phase8.appointmentsTitle',
    'phase9.medicineTitle',
    'phase8.referralsTitle',
  ],
  doctor: [
    'patient.list',
    'screening.list',
    'phase8.appointmentsTitle',
    'phase9.medicineTitle',
    'phase8.referralsTitle',
    'phase11.consultationsTitle',
    'phase11.analyticsTitle',
  ],
  specialist: [
    'patient.list',
    'phase8.referralsTitle',
    'phase11.consultationsTitle',
    'phase10.assistantTitle',
  ],
};

const administrationLinks = [
  'admin.userManagement',
  'patient.list',
  'patient.register',
  'phase11.analyticsTitle',
  'admin.reportsTitle',
  'admin.activityMonitor',
];

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const role = user.role;
  if (role === 'doctor') return <DoctorDashboardPage />;
  const actionKeys = ['admin', 'super_admin'].includes(role)
    ? administrationLinks
    : quickLinksByRole[role] || [];
  const quickLinks = actionKeys
    .map((key) => sidebarMenu.find((item) => item.key === key))
    .filter((item) => item && item.roles.includes(role));

  if (role === 'patient') {
    return (
      <div className="patient-glass-dashboard">
        <section aria-labelledby="patient-tools-title" className="patient-glass-window patient-glass-window--tools">
          <div className="patient-window-chrome" aria-hidden="true"><span /><span /><span /><small>{t('patientWorkspace.tools')}</small></div>
          <div className="patient-window-heading">
            <HeartPulse aria-hidden="true" size={20} />
            <div><p>{t('patientWorkspace.patientTools')}</p><h2 id="patient-tools-title">{t('patientWorkspace.title')}</h2></div>
          </div>
          <nav aria-label={t('patientWorkspace.patientTools')} className="patient-tool-links">
            {quickLinks.map(({ key, path, icon: Icon }) => (
              <Link key={key} to={path(roleDashboardPath[role])}>
                <Icon aria-hidden="true" size={18} /><span>{t(key)}</span><ArrowUpRight aria-hidden="true" size={16} />
              </Link>
            ))}
          </nav>
        </section>

        <section aria-labelledby="patient-medicine-title" className="patient-glass-window patient-glass-window--medicine">
          <div className="patient-window-chrome" aria-hidden="true"><span /><span /><span /><small>{t('patientWorkspace.healthReport')}</small></div>
          <div className="patient-window-heading">
            <HeartPulse aria-hidden="true" size={20} />
            <div><p>{t('patientWorkspace.carePlan')}</p><h2 id="patient-medicine-title">{t('patientWorkspace.medicationReport')}</h2></div>
          </div>
          <p className="patient-window-copy">{t('patientWorkspace.medicineDescription')}</p>
          <Link className="patient-window-action" to="/medicines">{t('patientWorkspace.openMedicines')} <ArrowUpRight aria-hidden="true" size={16} /></Link>
        </section>

        <section aria-label={t('patient.dashboardSummary')} className="patient-metrics-window">
          <div className="patient-metrics-window__heading">
            <div><p className="patient-metrics-window__eyebrow">{t('brandName')}</p><h1>{t('welcome', { name: user.full_name || t(`roles.${role}`) })}</h1><p>{t('dashboardDescription')}</p></div>
            <span className="patient-metrics-window__badge">{t('roles.patient')}</span>
          </div>
          <PatientDashboardOverview user={user} />
        </section>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <section aria-labelledby="dashboard-welcome" className="dashboard-welcome">
        <div className="dashboard-welcome__content">
          <p className="dashboard-welcome__brand">{t('brandName')}</p>
          <p className="dashboard-welcome__role">{t(`roles.${role}`)}</p>
          <h1 id="dashboard-welcome">
            {t('welcome', { name: user.full_name || t(`roles.${role}`) })}
          </h1>
          <p>{t('dashboardDescription')}</p>
          <span className="dashboard-welcome__demo">{t('demoNotice')}</span>
        </div>
        <span aria-hidden="true" className="dashboard-welcome__icon">
          <HeartPulse size={58} strokeWidth={1.5} />
        </span>
      </section>

      <section aria-labelledby="dashboard-quick-links" className="dashboard-shortcuts">
        <div className="dashboard-shortcuts__heading">
          <div>
            <p className="eyebrow">{t('dashboard')}</p>
            <h2 id="dashboard-quick-links">{t('dashboardQuickLinks')}</h2>
          </div>
          <p>{t('dashboardQuickLinksDescription')}</p>
        </div>
        <div className="dashboard-shortcuts__grid">
          {quickLinks.map(({ key, path, icon: Icon }) => (
            <Link
              className="dashboard-shortcut"
              key={key}
              to={path(roleDashboardPath[role])}
            >
              <span className="dashboard-shortcut__icon">
                <Icon aria-hidden="true" size={23} />
              </span>
              <span className="dashboard-shortcut__label">{t(key)}</span>
              <ArrowUpRight aria-hidden="true" className="dashboard-shortcut__arrow" size={19} />
            </Link>
          ))}
        </div>
      </section>

      <section aria-label={t('demoNotice')} className="dashboard-demo-note">
        <span className="dashboard-demo-note__icon">
          <HeartPulse aria-hidden="true" size={21} />
        </span>
        <p>{t('dashboardDemoNote')}</p>
      </section>
    </div>
  );
}
