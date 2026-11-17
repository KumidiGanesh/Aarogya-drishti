import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ClipboardCheck,
  FileBarChart2,
  Settings,
  Stethoscope,
  UserPlus,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import api from '../services/api.js';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Loading from '../components/ui/Loading.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { roleDashboardPath } from '../auth/roles.js';

const ROLE_COLORS = {
  patient: '#0866D9',
  doctor: '#0EA5E9',
  admin: '#10A676',
};

const metrics = [
  { key: 'totalDoctors', label: 'doctors', icon: Stethoscope, color: 'purple', href: (base) => `${base}/doctors` },
  { key: 'totalPatients', label: 'patients', icon: Users, color: 'blue', href: (base) => `${base}/patients` },
  { key: 'totalScreenings', label: 'screenings', icon: ClipboardCheck, color: 'teal', href: (base) => `${base}/reports` },
  { key: 'pendingScreeningReviews', label: 'pendingScreeningReviews', icon: Activity, color: 'orange', href: (base) => `${base}/reports` },
];

function Sparkline({ values = [], color }) {
  const points = values.map(Number).filter(Number.isFinite);
  if (!points.length) return <span aria-hidden="true" className="admin-sparkline admin-sparkline--empty" />;

  const width = 84;
  const height = 32;
  const min = Math.min(...points);
  const range = Math.max(...points) - min || 1;
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - ((point - min) / range) * (height - 6) - 3;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg aria-hidden="true" className="admin-sparkline" viewBox={`0 0 ${width} ${height}`}>
      <polyline fill="none" points={coordinates} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
    </svg>
  );
}

function formatDate(value, language, options = { month: 'short', day: 'numeric' }) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(language, options);
}

export default function AdminDashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [district, setDistrict] = useState('');
  const [range, setRange] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [activities, setActivities] = useState([]);
  const [activityError, setActivityError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get('/admin/dashboard', { params: district ? { district } : {} })
      .then((response) => {
        if (active) {
          setData(response.data.data);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError(t('admin.loadFailed'));
      });
    return () => {
      active = false;
    };
  }, [district, t]);

  useEffect(() => {
    let active = true;
    api.get('/admin/audit-logs', { params: { page: 1, limit: 5 } })
      .then(({ data: response }) => {
        if (active) {
          setActivities(response.data.items);
          setActivityError('');
        }
      })
      .catch(() => {
        if (active) setActivityError(t('admin.loadFailed'));
      });
    return () => {
      active = false;
    };
  }, [t]);

  const dashboardPath = roleDashboardPath[user.role] || '/admin';
  const quickActions = [
    { key: 'quickAddPatient', to: '/patients/register', icon: UserPlus, permission: 'patients:manage' },
    { key: 'quickAddDoctor', to: `${dashboardPath}/doctors`, icon: Stethoscope, permission: 'users:manage' },
    { key: 'quickViewReports', to: `${dashboardPath}/reports`, icon: FileBarChart2, permission: 'reports:read' },
    { key: 'quickManageUsers', to: `${dashboardPath}/users`, icon: Users, permission: 'users:manage' },
    {
      key: 'quickSettings',
      to: user.role === 'super_admin' ? `${dashboardPath}/settings` : '/settings',
      icon: Settings,
      permission: user.role === 'super_admin' ? 'settings:manage' : 'settings:read',
    },
  ].filter((action) => user.permissions?.includes(action.permission));
  const roleData = useMemo(
    () => Object.entries(data?.userRoleDistribution || {}).map(([role, value]) => ({
      role,
      name: t(`roles.${role}`, { defaultValue: role }),
      value: Number(value) || 0,
      color: ROLE_COLORS[role] || '#9aaabd',
    })).filter((item) => item.value > 0),
    [data?.userRoleDistribution, t],
  );
  const facilityMax = Math.max(0, ...(data?.facilityScreeningCounts || []).map((item) => Number(item.screenings) || 0));

  if (!data && !error) return <Loading />;

  return (
    <div className="admin-page admin-dashboard-page">
      <section aria-labelledby="admin-dashboard-heading" className="admin-dashboard-hero">
        <div className="admin-dashboard-hero__copy">
          <p className="eyebrow">{t('admin.administration')}</p>
          <h1 id="admin-dashboard-heading">{t('admin.dashboardTitle')}</h1>
          <p className="admin-dashboard-hero__description">{t('admin.dashboardDescription')}</p>
        </div>
        <div className="admin-dashboard-hero__tools">
          <Input
            id="dashboard-district"
            label={t('admin.districtFilter')}
            onChange={(event) => setDistrict(event.target.value)}
            value={district}
          />
          <div className="admin-dashboard-hero__user">
            <span aria-hidden="true" className="admin-dashboard-hero__avatar">
              {user.full_name?.slice(0, 1) || 'A'}
            </span>
            <span>
              <strong>{user.full_name}</strong>
              <small>{t(`roles.${user.role}`)}</small>
            </span>
          </div>
        </div>
      </section>

      {error && <p className="auth-error" role="alert">{error}</p>}

      {data && (
        <>
          <section aria-label={t('admin.statistics')} className="admin-dashboard-metrics">
            {metrics.map((metric) => {
              const { key, label, icon: Icon, color, href } = metric;
              const kpi = data.kpis?.[key];
              const value = kpi?.value ?? data[key] ?? 0;
              const change = Number.isFinite(kpi?.changePercent) ? kpi.changePercent : null;
              return (
                <Link className="admin-dashboard-metric-link" key={key} to={href(dashboardPath)}>
                  <Card className={`admin-dashboard-metric admin-dashboard-metric--${color}`}>
                    <span className="admin-dashboard-metric__icon"><Icon aria-hidden="true" size={21} /></span>
                    <span className="admin-dashboard-metric__label">{t(`admin.${label}`)}</span>
                    <strong className="admin-dashboard-metric__value">{Number(value).toLocaleString(i18n.language)}</strong>
                    {change !== null && (
                      <span className={`admin-dashboard-metric__change${change < 0 ? ' admin-dashboard-metric__change--down' : ''}`}>
                        {change < 0 ? <ArrowDownRight aria-hidden="true" size={15} /> : <ArrowUpRight aria-hidden="true" size={15} />}
                        {change > 0 ? '+' : ''}{change}% <small>{t('admin.vsPreviousPeriod')}</small>
                      </span>
                    )}
                    <Sparkline color={`var(--admin-${color})`} values={kpi?.trend || []} />
                  </Card>
                </Link>
              );
            })}
          </section>

          <section aria-label={t('admin.quickActions')} className="admin-dashboard-quick-actions">
            <div className="admin-dashboard-section-heading">
              <div>
                <h2>{t('admin.quickActions')}</h2>
                <p>{t('admin.quickActionsDescription')}</p>
              </div>
            </div>
            <div className="admin-dashboard-action-grid">
              {quickActions.map(({ key, to, icon: Icon }) => (
                <Link className="admin-dashboard-action" key={key} to={to}>
                  <span className="admin-dashboard-action__icon"><Icon aria-hidden="true" size={19} /></span>
                  <span>{t(`admin.${key}`)}</span>
                  <ArrowRight aria-hidden="true" className="admin-dashboard-action__arrow" size={16} />
                </Link>
              ))}
            </div>
          </section>

          <div className="admin-dashboard-grid admin-dashboard-grid--trends">
            <Card className="admin-dashboard-panel admin-dashboard-registration-chart">
              <div className="admin-dashboard-section-heading">
                <div>
                  <h2>{t('admin.registrationTrend')}</h2>
                  <p>{t('admin.dashboardChartDescription')}</p>
                </div>
                <div aria-label={t('admin.registrationTrend')} className="admin-range" role="group">
                  {[7, 30].map((days) => (
                    <button
                      aria-pressed={range === days}
                      className={range === days ? 'admin-range__active' : ''}
                      key={days}
                      onClick={() => setRange(days)}
                      type="button"
                    >
                      {t('admin.days', { count: days })}
                    </button>
                  ))}
                </div>
              </div>
              <div className="admin-dashboard-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.registrationTrend?.[`days${range}`] || []} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="#e8eef5" strokeDasharray="4 4" vertical={false} />
                    <XAxis
                      axisLine={false}
                      dataKey="date"
                      tick={{ fill: '#52677d', fontSize: 12 }}
                      tickFormatter={(value) => formatDate(value, i18n.language)}
                      tickLine={false}
                    />
                    <YAxis allowDecimals={false} axisLine={false} tick={{ fill: '#52677d', fontSize: 12 }} tickLine={false} />
                    <Tooltip labelFormatter={(value) => formatDate(value, i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })} />
                    <Line dataKey="registrations" name={t('admin.registrations')} stroke="#4389ef" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="admin-dashboard-panel admin-dashboard-screening-chart">
              <div className="admin-dashboard-section-heading">
                <div>
                  <h2>{t('admin.monthlyScreeningVolume')}</h2>
                  <p>{t('admin.screenings')}</p>
                </div>
                <span aria-hidden="true" className="admin-dashboard-panel__badge"><ClipboardCheck size={18} /></span>
              </div>
              <div className="admin-dashboard-chart admin-dashboard-chart--compact">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.screeningTrend || []} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="#e8eef5" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="month" axisLine={false} tick={{ fill: '#52677d', fontSize: 11 }} tickLine={false} />
                    <YAxis allowDecimals={false} axisLine={false} tick={{ fill: '#52677d', fontSize: 11 }} tickLine={false} />
                    <Tooltip />
                    <Bar dataKey="screenings" name={t('admin.screenings')} fill="#27a6a0" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="admin-dashboard-grid admin-dashboard-grid--insights">
            <Card className="admin-dashboard-panel admin-dashboard-roles">
              <div className="admin-dashboard-section-heading">
                <div>
                  <h2>{t('admin.userRoleDistribution')}</h2>
                  <p>{t('admin.dashboardRoleDescription')}</p>
                </div>
              </div>
              {roleData.length ? (
                <div className="admin-dashboard-roles__content">
                  <div className="admin-dashboard-donut">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={roleData} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={3} stroke="none">
                          {roleData.map((item) => <Cell fill={item.color} key={item.role} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="admin-dashboard-legend">
                    {roleData.map((item) => (
                      <li key={item.role}>
                        <span><i aria-hidden="true" style={{ backgroundColor: item.color }} />{item.name}</span>
                        <strong>{item.value.toLocaleString(i18n.language)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <p className="admin-dashboard-empty">{t('admin.noRoleData')}</p>}
            </Card>

            <Card className="admin-dashboard-panel admin-dashboard-facilities">
              <div className="admin-dashboard-section-heading">
                <div>
                  <h2>{t('admin.screeningsByFacility')}</h2>
                  <p>{t('admin.facilityScreeningDescription')}</p>
                </div>
                <span aria-hidden="true" className="admin-dashboard-panel__badge"><CalendarDays size={18} /></span>
              </div>
              {data.facilityScreeningCounts?.length ? (
                <ul className="admin-dashboard-facility-list">
                  {data.facilityScreeningCounts.slice(0, 5).map((facility) => (
                    <li key={facility.name}>
                      <div><span>{facility.name}</span><strong>{Number(facility.screenings).toLocaleString(i18n.language)}</strong></div>
                      <span aria-hidden="true" className="admin-dashboard-facility-bar">
                        <i style={{ width: `${facilityMax ? Math.max(4, (Number(facility.screenings) / facilityMax) * 100) : 0}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="admin-dashboard-empty">{t('admin.noFacilityScreenings')}</p>}
            </Card>
          </div>

          <div className="admin-dashboard-grid admin-dashboard-grid--activity">
            <Card className="admin-dashboard-panel admin-dashboard-activity">
              <div className="admin-dashboard-section-heading">
                <div>
                  <h2>{t('admin.recentActivity')}</h2>
                  <p>{t('admin.dashboardActivityDescription')}</p>
                </div>
                <Link className="admin-dashboard-view-all" to={`${dashboardPath}/audit-logs`}>
                  {t('admin.viewAll')} <ArrowRight aria-hidden="true" size={16} />
                </Link>
              </div>
              {activityError ? <p className="auth-error" role="alert">{activityError}</p> : activities.length ? (
                <div className="table-scroll admin-dashboard-activity-scroll">
                  <table className="admin-dashboard-activity-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('admin.resourceId')}</th>
                        <th scope="col">{t('admin.actor')}</th>
                        <th scope="col">{t('admin.action')}</th>
                        <th scope="col">{t('admin.date')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activities.map((item) => (
                        <tr key={item.id}>
                          <td className="admin-dashboard-activity-table__id" title={item.id}>
                            {item.id?.slice(0, 8) || '—'}
                          </td>
                          <td>{item.user_name || '—'}</td>
                          <td>
                            <span className="admin-dashboard-activity-table__action">
                              {item.action?.replace(/[._]/g, ' ') || '—'}
                            </span>
                          </td>
                          <td>
                            <time dateTime={item.created_at}>
                              {formatDate(item.created_at, i18n.language)}
                            </time>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="admin-dashboard-empty">{t('admin.noRecentActivity')}</p>}
            </Card>

            <Card className="admin-dashboard-panel admin-dashboard-registrations">
              <div className="admin-dashboard-section-heading">
                <div>
                  <h2>{t('admin.recentRegistrations')}</h2>
                  <p>{t('admin.dashboardRegistrationDescription')}</p>
                </div>
                <Link className="admin-dashboard-view-all" to={`${dashboardPath}/patients`}>
                  {t('admin.viewAll')} <ArrowRight aria-hidden="true" size={16} />
                </Link>
              </div>
              {data.recentRegistrations?.length ? (
                <ul className="admin-dashboard-registration-list">
                  {data.recentRegistrations.slice(0, 5).map((patient) => (
                    <li key={patient.id}>
                      <span className="admin-dashboard-registration__avatar">{(patient.full_name || patient.patient_code || 'P').slice(0, 1)}</span>
                      <span className="admin-dashboard-registration__content">
                        <strong>{patient.full_name || patient.patient_code}</strong>
                        <small>{[patient.village_name, patient.phc_name].filter(Boolean).join(' · ') || t('admin.patientCode')}</small>
                      </span>
                      <time dateTime={patient.created_at}>{formatDate(patient.created_at, i18n.language)}</time>
                    </li>
                  ))}
                </ul>
              ) : <p className="admin-dashboard-empty">{t('admin.noRecentRegistrations')}</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
