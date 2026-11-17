import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Card from '../components/ui/Card.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import api from '../services/api.js';

const startDate = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const chartData = (values, t) => (values || []).map((item) => ({
  name: item.name || t(`phase11.status.${item.status || item.risk_category}`, { defaultValue: item.status || item.risk_category || '—' }),
  total: Number(item.total || item.taken || 0),
}));

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [filters, setFilters] = useState({ from: startDate(), to: new Date().toISOString().slice(0, 10), district: '' });
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async (extra = {}) => {
    try {
      const { data } = await api.get('/reports/analytics', { params: { ...filters, ...extra, district: filters.district || undefined } });
      setReport(data.data);
      setError('');
    } catch {
      setError(t('phase11.settingsError'));
    }
  }, [filters, t]);
  useEffect(() => { load(); }, [load]);
  const exportReport = async (format) => {
    try {
      const response = await api.get('/reports/analytics', {
        params: { ...filters, export: format, district: filters.district || undefined },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `aarogya-analytics.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('phase11.settingsError'));
    }
  };
  const sections = report ? [
    ['villageStatistics', report.village_statistics],
    ['phcStatistics', report.phc_statistics],
    ['districtStatistics', report.district_statistics],
    ['screeningStatistics', report.screening_statistics],
    ['referralStatistics', report.referral_statistics],
    ['appointmentStatistics', report.appointment_statistics],
    ['medicineAdherence', report.medicine_adherence],
    ['emergencyStatistics', report.emergency_statistics],
  ] : [];
  return (
    <div className="admin-page">
      <div className="page-heading"><h1>{t('phase11.analyticsTitle')}</h1></div>
      <Card>
        <div className="filter-row">
          <label>{t('phase11.dateFrom')}<input onChange={(event) => setFilters({ ...filters, from: event.target.value })} type="date" value={filters.from} /></label>
          <label>{t('phase11.dateTo')}<input onChange={(event) => setFilters({ ...filters, to: event.target.value })} type="date" value={filters.to} /></label>
          {user.role !== 'doctor' && <label>{t('phase11.districtStatistics')}<input onChange={(event) => setFilters({ ...filters, district: event.target.value })} value={filters.district} /></label>}
          <button className="button" onClick={() => load()} type="button">{t('phase11.filter')}</button>
        </div>
        {['reports.export', 'export'].some((permission) => user.permissions?.includes(permission)) && (
          <div className="filter-row">
            <button className="button button--secondary" onClick={() => exportReport('csv')} type="button">{t('phase11.exportCsv')}</button>
            <button className="button button--secondary" onClick={() => exportReport('pdf')} type="button">{t('phase11.exportPdf')}</button>
          </div>
        )}
      </Card>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <Card><h2>{t('phase11.totalRegistrations')}</h2><strong className="analytics-total">{report.total_registrations}</strong></Card>
          <div className="analytics-grid">
            {sections.map(([key, data]) => (
              <Card key={key}>
                <h2>{t(`phase11.${key}`)}</h2>
                <div className="analytics-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData(data, t)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="total" fill="#2196f3" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
