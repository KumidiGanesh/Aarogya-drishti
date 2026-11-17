import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useTranslation } from 'react-i18next';
import api from '../services/api.js';
import Loading from '../components/ui/Loading.jsx';
import Card from '../components/ui/Card.jsx';
import AdminDashboardPage from './AdminDashboardPage.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

const managementLinks = [
  ['admin.userManagement', 'users', 'users:read'],
  ['admin.doctorManagement', 'doctors', 'users:read'],
  ['admin.createAdminAccount', 'administrators', 'users:manage'],
  ['admin.rolePermissions', 'roles', 'roles:manage'],
  ['admin.reportsTitle', 'reports', 'reports:read'],
  ['admin.activityMonitor', 'audit-logs', 'users:read'],
  ['admin.systemSettings', 'settings', 'settings:manage'],
  ['admin.facilityDirectory', 'facilities', 'users:read'],
];

export default function SuperAdminDashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [riskCases, setRiskCases] = useState([]);
  const [riskDistribution, setRiskDistribution] = useState([]);
  const [riskError, setRiskError] = useState('');
  const [riskLoading, setRiskLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api.get('/admin/dashboard/risk-cases', { params: { page: 1, limit: 10 } })
      .then(({ data }) => {
        if (active) {
          setRiskCases(data.data.items);
          setRiskDistribution(Object.entries(data.data.distribution || {}).map(([name, value]) => ({ name, value })));
        }
      })
      .catch(() => { if (active) setRiskError(t('admin.riskCasesLoadFailed')); })
      .finally(() => { if (active) setRiskLoading(false); });
    return () => { active = false; };
  }, [t]);
  const riskColors = ['#e07832', '#d94343', '#c72f45'];
  const links = managementLinks.filter(([, , permission]) => user?.permissions?.includes(permission));
  return (
    <>
      <AdminDashboardPage />
      <Card className="admin-table-card">
        <div className="admin-section-heading">
          <h2>{t('admin.superAdminControls')}</h2>
        </div>
        <nav aria-label={t('admin.superAdminControls')} className="super-admin-links">
          {links.map(([label, path], index) => (
            <Link key={`${path}-${label}-${index}`} to={`/super-admin/${path}`}>
              {t(label)}
            </Link>
          ))}
        </nav>
      </Card>
      <section className="super-admin-analytics" aria-label={t('admin.screeningRiskMonitoring')}>
        <Card className="admin-chart">
          <div className="admin-section-heading"><h2><Activity size={19} /> {t('admin.screeningRiskCases')}</h2></div>
          {riskLoading ? <Loading /> : riskError ? <p className="auth-error" role="alert">{riskError}</p> : riskDistribution.length ? (
            <div className="admin-chart__body">
              <ResponsiveContainer width="100%" height="100%"><PieChart>
                <Pie data={riskDistribution} dataKey="value" nameKey="name" innerRadius="54%" outerRadius="78%" paddingAngle={3}>
                  {riskDistribution.map((entry, index) => <Cell key={entry.name} fill={riskColors[index % riskColors.length]} />)}
                </Pie><Tooltip />
              </PieChart></ResponsiveContainer>
            </div>
          ) : <p className="super-admin-empty">{t('admin.noRiskClassifications')}</p>}
          {riskDistribution.map((entry, index) => <div className="super-admin-risk-row" key={entry.name}><span><i style={{ background: riskColors[index % riskColors.length] }} />{t(`screening.riskLabels.${entry.name}`, { defaultValue: entry.name.replaceAll('_', ' ') })}</span><strong>{entry.value}</strong></div>)}
        </Card>
        <Card className="admin-table-card">
          <div className="admin-section-heading"><h2><AlertTriangle size={19} /> {t('admin.highRiskMonitoring')}</h2><Link to="/screenings">{t('admin.screeningRecords')}</Link></div>
          {riskLoading ? <Loading /> : riskError ? <p className="auth-error" role="alert">{riskError}</p> : (
            <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('admin.patientId')}</th><th>{t('admin.patientName')}</th><th>{t('admin.facility')}</th><th>{t('screening.riskLabel')}</th><th>{t('screening.date')}</th><th>{t('admin.followUp')}</th></tr></thead>
              <tbody>{riskCases.map((row) => <tr key={row.id} className={/critical|urgent/i.test(row.risk_category) ? 'risk-case-critical' : ''}>
                <td>{row.patient_code}</td><td>{row.patient_name || t('admin.restricted')}</td><td>{row.facility || '—'}</td>
                <td><span className={`risk-pill risk-pill--${/critical|urgent/i.test(row.risk_category) ? 'critical' : 'high'}`}>{t(`screening.riskLabels.${row.risk_category}`, { defaultValue: row.risk_category.replaceAll('_', ' ') })}</span></td>
                <td>{row.screening_date ? new Date(row.screening_date).toLocaleDateString() : '—'}</td><td>{row.follow_up_status ? t(`screening.followUpStatuses.${row.follow_up_status}`, { defaultValue: row.follow_up_status.replaceAll('_', ' ') }) : '—'}</td>
              </tr>)}{!riskCases.length && <tr><td className="table-empty" colSpan="6">{t('admin.noHighRiskCases')}</td></tr>}</tbody>
            </table></div>
          )}
        </Card>
      </section>
    </>
  );
}
