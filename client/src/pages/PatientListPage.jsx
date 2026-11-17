import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Loading from '../components/ui/Loading.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import Select from '../components/ui/Select.jsx';
import Table from '../components/ui/Table.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';
import { useAuth } from '../auth/AuthContext.jsx';

export default function PatientListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [district, setDistrict] = useState('');
  const [gender, setGender] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/patients', {
        params: {
          page,
          limit: 10,
          ...(search ? { search } : {}),
          ...(district ? { district } : {}),
          ...(gender ? { gender } : {}),
        },
      });
      setResult(data);
    } catch {
      notify(t('patient.registrationError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [district, gender, notify, page, search, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = [
    { key: 'patient_code', header: t('admin.patientCode') },
    { key: 'full_name', header: t('patient.fullName') },
    { key: 'mobile', header: t('patient.mobile') },
    { key: 'village_name', header: t('patient.village') },
    { key: 'district', header: t('patient.district') },
    { key: 'phc_name', header: t('patient.phc') },
    {
      key: 'view',
      header: t('admin.actions'),
      render: (row) => (
        <Link className="button button--outline patient-view-link" to={`/patients/${row.id}`}>
          {t('patient.profile')}
        </Link>
      ),
    },
  ];

  if (loading && !result) return <Loading label={t('patient.loading')} />;
  return (
    <div className="patient-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('patient.management')}</p>
          <h1>{user.role === 'doctor' ? t('doctorNavigation.patients') : t('patient.list')}</h1>
        </div>
        {['health_worker', 'admin', 'super_admin'].includes(user.role) && (
          <Link className="button button--primary patient-create-link" to="/patients/register">
            <Plus aria-hidden="true" size={18} />
            {t('patient.register')}
          </Link>
        )}
      </div>
      <Card className="patient-filter-card">
        <div className="patient-search-field">
          <Search aria-hidden="true" size={18} />
          <Input
            id="patient-search"
            label={t('patient.search')}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            value={search}
          />
        </div>
        <Input
          id="patient-district-filter"
          label={t('patient.filterDistrict')}
          onChange={(event) => {
            setDistrict(event.target.value);
            setPage(1);
          }}
          value={district}
        />
        <Select
          id="patient-gender-filter"
          label={t('patient.filterGender')}
          onChange={(event) => {
            setGender(event.target.value);
            setPage(1);
          }}
          value={gender}
        >
          <option value="">{t('patient.all')}</option>
          <option value="female">{t('patient.female')}</option>
          <option value="male">{t('patient.male')}</option>
          <option value="non_binary">{t('patient.nonBinary')}</option>
          <option value="undisclosed">{t('patient.undisclosed')}</option>
        </Select>
      </Card>
      <Card className="patient-table-card">
        <Table columns={columns} rows={result?.data?.items || []} />
        {result?.meta && (
          <Pagination
            onPageChange={setPage}
            page={result.meta.page}
            totalPages={result.meta.totalPages}
          />
        )}
        {result?.data?.items?.length === 0 && (
          <p className="patient-empty">{t('patient.noPatients')}</p>
        )}
      </Card>
    </div>
  );
}
