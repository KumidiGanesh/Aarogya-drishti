import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, ArrowRight, CalendarDays, CheckCircle2, Clock3, ClipboardCheck, HeartPulse, ScanLine, Stethoscope, TriangleAlert, Users, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import api from '../services/api.js';
import Card from '../components/ui/Card.jsx';

const actions = [
  { title: 'myPatients', path: '/patients', Icon: Users, color: 'blue', hint: 'myPatientsHint' },
  { title: 'startScreening', path: '/screenings/new', Icon: ScanLine, color: 'mint', hint: 'screeningHint' },
  { title: 'videoConsultation', path: '/consultations', Icon: Video, color: 'violet', hint: 'videoHint' },
  { title: 'viewAppointments', path: '/appointments', Icon: CalendarDays, color: 'amber', hint: 'appointmentsHint' },
  { title: 'viewReports', path: '/screenings', Icon: ClipboardCheck, color: 'green', hint: 'reportsHint' },
];

function getItems(response) {
  const items = response?.data?.data?.items ?? response?.data?.items;
  return Array.isArray(items) ? items : [];
}
function getTotal(response) { return Number.isFinite(response?.data?.meta?.total) ? response.data.meta.total : null; }
function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function formatTime(item, language, t) {
  if (item.time_slot) return item.time_slot;
  if (item.scheduled_at) return new Date(item.scheduled_at).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' });
  return t('doctorDashboard.timeToConfirm');
}
function formatDate(value, language) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(language, { weekday: 'short', month: 'short', day: 'numeric' });
}
function riskCount(statistics = []) {
  const highRiskNames = new Set(['high', 'high_risk', 'high risk', 'severe', 'critical', 'urgent']);
  return statistics.reduce((total, row) => highRiskNames.has(String(row.risk_category || '').toLowerCase()) ? total + Number(row.total || 0) : total, 0);
}

function DataMessage({ children, onRetry, retryLabel }) {
  return <div className="doctor-data-message" role={onRetry ? 'alert' : undefined}><span>{children}</span>{onRetry && <button onClick={onRetry} type="button">{retryLabel}</button>}</div>;
}

function Panel({ eyebrow, title, icon: Icon, action, children, className = '' }) {
  return <Card className={`doctor-panel ${className}`}>
    <div className="doctor-panel__heading"><div className="doctor-panel__title-icon"><Icon size={19} /></div><div><span>{eyebrow}</span><h2>{title}</h2></div>{action && <Link to={action.to}>{action.label}<ArrowRight size={15} /></Link>}</div>
    {children}
  </Card>;
}

export default function DoctorDashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);
  const today = new Date();
  const todayKey = localDateKey(today);
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const profile = user?.profile || {};
  const language = i18n.resolvedLanguage || i18n.language;

  const load = useCallback(async () => {
    setLoading(true);
    const settled = await Promise.allSettled([
      api.get('/patients', { params: { page: 1, limit: 1 } }),
      api.get('/patients', { params: { page: 1, limit: 5 } }),
      api.get('/appointments', { params: { upcoming: 'true', page: 1, limit: 5 } }),
      api.get('/screenings', { params: { from: monthStart, to: todayKey, page: 1, limit: 100 } }),
      api.get('/screenings', { params: { page: 1, limit: 100 } }),
      api.get('/reports/analytics', { params: { from: monthStart, to: todayKey } }),
    ]);
    const value = (index) => settled[index].status === 'fulfilled' ? settled[index].value : null;
    const [patientsCount, patientsRecent, appointments, screenings, recentScreenings, analytics] = [0, 1, 2, 3, 4, 5].map(value);
    setData({
      patientCount: getTotal(patientsCount), patients: getItems(patientsRecent),
      appointmentCount: getTotal(appointments), appointments: getItems(appointments),
      screeningCount: getTotal(screenings), screenings: getItems(recentScreenings),
      highRiskCount: analytics ? riskCount(analytics.data?.data?.screening_statistics) : null,
    });
    setErrors(settled.flatMap((result, index) => result.status === 'rejected' ? [index === 5 ? 'doctorDashboard.highRiskUnavailable' : 'doctorDashboard.loadError'] : []));
    setLoading(false);
  }, [monthStart, todayKey]);

  useEffect(() => { void load(); }, [load]);

  const latestScreeningByPatient = new Map();
  for (const screening of data?.screenings || []) {
    if (screening.patient_id && !latestScreeningByPatient.has(screening.patient_id)) latestScreeningByPatient.set(screening.patient_id, screening);
  }
  const stats = [
    { label: 'totalPatients', value: data?.patientCount, caption: 'patientsCaption', Icon: Users, color: 'blue', path: '/patients' },
    { label: 'upcomingAppointments', value: data?.appointmentCount, caption: 'appointmentsCaption', Icon: CalendarDays, color: 'mint', path: '/appointments' },
    { label: 'screeningsMonth', value: data?.screeningCount, caption: 'screeningsCaption', Icon: ScanLine, color: 'violet', path: '/screenings' },
    { label: 'highRiskCases', value: data?.highRiskCount, caption: 'highRiskCaption', Icon: TriangleAlert, color: 'rose', path: '/screenings' },
  ];

  return <div className="doctor-dashboard">
    <section className="doctor-hero">
      <div className="doctor-hero__copy">
        <p className="doctor-eyebrow">{t('doctorDashboard.eyebrow')}</p>
        <h1>{t('doctorDashboard.welcome', { name: user?.full_name || t('roles.doctor') })}</h1>
        <p>{t('doctorDashboard.subtitle')}</p>
        <div className="doctor-hero__badge"><Stethoscope size={18} /><span>Aarogya Drishti <b>—</b> {t('doctorDashboard.screeningBadge')}</span></div>
      </div>
      <div className="doctor-hero__art" aria-hidden="true"><div className="doctor-hero__halo" /><div className="doctor-hero__tooth"><HeartPulse size={58} strokeWidth={1.35} /></div><span className="doctor-hero__spark doctor-hero__spark--one">✦</span><span className="doctor-hero__spark doctor-hero__spark--two">+</span></div>
    </section>

    <section aria-label={t('doctorDashboard.quickActions')} className="doctor-actions">
      {actions.map(({ title, path, Icon, color, hint }) => <Link className={`doctor-action doctor-action--${color}`} key={title} to={path}>
        <span className="doctor-action__icon"><Icon size={25} strokeWidth={2.2} /></span><span className="doctor-action__text"><strong>{t(`doctorDashboard.${title}`)}</strong><small>{t(`doctorDashboard.${hint}`)}</small></span><span className="doctor-action__arrow"><ArrowRight size={17} /></span>
      </Link>)}
    </section>

    <section aria-label={t('doctorDashboard.statistics')} className="doctor-stat-grid">
      {stats.map(({ label, value, caption, Icon, color, path }) => <Link className={`doctor-stat doctor-stat--${color}`} key={label} to={path}>
        <div className="doctor-stat__top"><span className="doctor-stat__icon"><Icon size={23} /></span><span className="doctor-stat__trend"><Activity size={15} /> {t('doctorDashboard.live')}</span></div>
        <strong className="doctor-stat__value">{loading && value == null ? <span className="doctor-skeleton" /> : value ?? '—'}</strong><span className="doctor-stat__label">{t(`doctorDashboard.${label}`)}</span><small>{t(`doctorDashboard.${caption}`)}</small>
      </Link>)}
    </section>

    {errors.length > 0 && <DataMessage retryLabel={t('doctorDashboard.tryAgain')} onRetry={() => void load()}>{[...new Set(errors)].map((message) => t(message)).join(' ')}</DataMessage>}

    <section className="doctor-main-grid">
      <Panel eyebrow={t('doctorDashboard.schedule')} title={t('doctorDashboard.upcomingTitle')} icon={CalendarDays} action={{ to: '/appointments', label: t('doctorDashboard.viewAll') }}>
        {loading && !data ? <DataMessage>{t('doctorDashboard.loadingAppointments')}</DataMessage> : data?.appointments?.length ? <div className="doctor-appointment-list">{data.appointments.slice(0, 4).map((item) => {
          const date = formatDate(item.scheduled_at, language);
          return <div className="doctor-appointment" key={item.id}>
            <div className="doctor-appointment__date"><strong>{date?.split(' ')[1]?.replace(',', '') || '—'}</strong><small>{date?.split(' ')[0] || t('doctorDashboard.dateToConfirm')}</small></div>
            <div className="doctor-appointment__patient"><strong>{item.patient_name || item.patient_code || t('doctorDashboard.authorizedPatient')}</strong><small>{item.facility_name || item.patient_code || t('doctorDashboard.authorizedPatient')}</small></div>
            <span className="doctor-appointment__time"><Clock3 size={15} />{formatTime(item, language, t)}</span>
            <span className={`doctor-status doctor-status--${item.status || 'booked'}`}>{t(`doctorDashboard.statuses.${item.status || 'scheduled'}`, { defaultValue: item.status || 'scheduled' })}</span>
          </div>;
        })}</div> : <DataMessage>{t('doctorDashboard.emptyAppointments')}</DataMessage>}
      </Panel>

      <Panel eyebrow={t('doctorDashboard.patientsEyebrow')} title={t('doctorDashboard.myPatients')} icon={Users} action={{ to: '/patients', label: t('doctorDashboard.viewAll') }}>
        {loading && !data ? <DataMessage>{t('doctorDashboard.loadingPatients')}</DataMessage> : data?.patients?.length ? <div className="doctor-patient-list">{data.patients.slice(0, 4).map((patient) => {
          const patientId = patient.id || patient.patient_id;
          const patientCode = patient.patient_code || patient.patientId || patientId;
          const patientName = patient.full_name || patient.patient_name || patient.name || t('doctorDashboard.authorizedPatient');
          const screening = latestScreeningByPatient.get(patientId);
          const gender = patient.gender ? t(`patient.${patient.gender}`, { defaultValue: patient.gender }) : null;
          return <Link className="doctor-patient-row" key={patientId || patientCode} to={`/patients/${patientId || patientCode}`}>
            <span className="doctor-patient-avatar">{patientName.slice(0, 1) || 'P'}</span><span className="doctor-patient-row__details"><strong>{patientName}</strong><small>{[gender, patientCode && `${t('admin.patientId')}: ${patientCode}`].filter(Boolean).join(' · ')}</small></span>
            <span className={`doctor-patient-status${screening ? ' doctor-patient-status--screened' : ''}`}>{screening ? t('doctorDashboard.screened') : t('doctorDashboard.noScreening')}</span>
          </Link>;
        })}</div> : <DataMessage>{t('doctorDashboard.emptyPatients')}</DataMessage>}
      </Panel>

      <Panel eyebrow={t('doctorDashboard.awarenessEyebrow')} title={t('doctorDashboard.awarenessTitle')} icon={HeartPulse} className="doctor-awareness">
        <div className="doctor-awareness__visual"><div className="doctor-awareness__ring"><HeartPulse size={53} /></div><span>{t('doctorDashboard.awarenessEyebrow')}</span></div>
        <div className="doctor-awareness__copy"><h3>{t('doctorDashboard.awarenessHeadline')}</h3><p>{t('doctorDashboard.awarenessBody')}</p><Link to="/screenings">{t('doctorDashboard.screeningGuidance')} <ArrowRight size={15} /></Link></div>
      </Panel>
    </section>

    <footer className="doctor-dashboard__footer"><span><CheckCircle2 size={15} /> {t('doctorDashboard.secureWorkspace')}</span><span>{profile.specialty || t('roles.doctor')}{profile.facility_name ? ` · ${profile.facility_name}` : ''}</span></footer>
  </div>;
}
