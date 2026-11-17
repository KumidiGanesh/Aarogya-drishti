import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../services/api.js';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Select from '../components/ui/Select.jsx';
import Table from '../components/ui/Table.jsx';
import { useToast } from '../components/ui/Toast.jsx';

const REPORTS = ['users', 'patients', 'appointments', 'referrals', 'screenings', 'emergency'];

export default function AdminReportsPage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [filters, setFilters] = useState({ type: 'users', from: '', to: '', format: 'csv' });
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const generate = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const { data, headers } = await api.get('/admin/reports', {
        params,
        responseType: filters.format === 'json' ? 'json' : 'blob',
      });
      if (filters.format === 'json') {
        setRows(data.data.items);
      } else {
        const url = URL.createObjectURL(new Blob([data], { type: headers['content-type'] }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filters.type}-report.${filters.format}`;
        link.click();
        URL.revokeObjectURL(url);
        setRows(null);
      }
    } catch {
      notify(t('admin.reportFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const columns = rows?.length
    ? Object.keys(rows[0]).map((key) => ({
        key,
        header: key,
        render: (row) => (row[key] == null ? '—' : String(row[key])),
      }))
    : [];
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('admin.administration')}</p>
          <h1>{t('admin.reportsTitle')}</h1>
        </div>
      </div>
      <Card className="admin-report-card">
        <form className="admin-filter-card" onSubmit={generate}>
          <Select
            id="report-type"
            label={t('admin.reportType')}
            onChange={(event) => setFilters({ ...filters, type: event.target.value })}
            value={filters.type}
          >
            {REPORTS.map((type) => (
              <option key={type} value={type}>
                {t(`admin.reportTypes.${type}`)}
              </option>
            ))}
          </Select>
          <Input
            id="report-from"
            label={t('admin.from')}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            type="date"
            value={filters.from}
          />
          <Input
            id="report-to"
            label={t('admin.to')}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            type="date"
            value={filters.to}
          />
          <Select
            id="report-format"
            label={t('admin.format')}
            onChange={(event) => setFilters({ ...filters, format: event.target.value })}
            value={filters.format}
          >
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
            <option value="json">JSON</option>
          </Select>
          <Button disabled={busy}>
            <FileDown size={18} />
            {busy ? t('loading') : t('admin.generateReport')}
          </Button>
        </form>
      </Card>
      {rows && (
        <Card className="admin-table-card">
          <Table columns={columns} rows={rows} />
        </Card>
      )}
    </div>
  );
}
