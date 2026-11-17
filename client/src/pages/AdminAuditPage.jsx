import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../services/api.js';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Loading from '../components/ui/Loading.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import Table from '../components/ui/Table.jsx';

export default function AdminAuditPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ action: '', resource: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/audit-logs', {
        params: {
          page,
          limit: 20,
          ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
        },
      });
      setResult(data);
      setError('');
    } catch {
      setError(t('admin.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [filters, page, t]);
  useEffect(() => {
    load();
  }, [load]);
  const columns = useMemo(
    () => [
      {
        key: 'created_at',
        header: t('admin.date'),
        render: (row) => new Date(row.created_at).toLocaleString(),
      },
      { key: 'user_name', header: t('admin.actor') },
      { key: 'user_role', header: t('admin.role') },
      { key: 'action', header: t('admin.action') },
      { key: 'entity', header: t('admin.resource') },
      { key: 'entity_id', header: t('admin.resourceId') },
      {
        key: 'metadata',
        header: t('admin.details'),
        render: (row) => JSON.stringify(row.metadata),
      },
    ],
    [t],
  );
  if (loading && !result) return <Loading />;
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('admin.administration')}</p>
          <h1>{t('admin.activityMonitor')}</h1>
        </div>
      </div>
      <Card className="admin-filter-card">
        <Input
          id="audit-action"
          label={t('admin.action')}
          onChange={(event) => {
            setFilters({ ...filters, action: event.target.value });
            setPage(1);
          }}
          value={filters.action}
        />
        <Input
          id="audit-resource"
          label={t('admin.resource')}
          onChange={(event) => {
            setFilters({ ...filters, resource: event.target.value });
            setPage(1);
          }}
          value={filters.resource}
        />
        <Input
          id="audit-from"
          label={t('admin.from')}
          onChange={(event) => {
            setFilters({ ...filters, from: event.target.value });
            setPage(1);
          }}
          type="date"
          value={filters.from}
        />
        <Input
          id="audit-to"
          label={t('admin.to')}
          onChange={(event) => {
            setFilters({ ...filters, to: event.target.value });
            setPage(1);
          }}
          type="date"
          value={filters.to}
        />
      </Card>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <Card className="admin-table-card">
        <Table columns={columns} rows={result?.data?.items || []} />
        <Pagination
          onPageChange={setPage}
          page={result?.meta?.page || 1}
          totalPages={result?.meta?.totalPages || 1}
        />
      </Card>
    </div>
  );
}
