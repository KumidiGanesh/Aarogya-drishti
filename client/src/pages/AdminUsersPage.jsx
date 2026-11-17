import { useCallback, useEffect, useState } from 'react';
import { Check, Eye, FileDown, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../services/api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import Select from '../components/ui/Select.jsx';
import Table from '../components/ui/Table.jsx';
import Loading from '../components/ui/Loading.jsx';
import { useToast } from '../components/ui/Toast.jsx';

const EMPTY_FORM = {
  full_name: '',
  mobile: '',
  email: '',
  username: '',
  role: 'doctor',
  admin_id: '',
  password: '',
  confirm_password: '',
  preferred_language: 'en',
  is_active: true,
  reset_password: false,
  profile: {
    registration_number: '',
    qualification: '',
    worker_code: '',
    specialty: '',
    availability: {},
    phc_id: '',
    hospital_id: '',
  },
};
const AVAILABILITY_DAYS = [
  ['0', 'admin.sunday'],
  ['1', 'admin.monday'],
  ['2', 'admin.tuesday'],
  ['3', 'admin.wednesday'],
  ['4', 'admin.thursday'],
  ['5', 'admin.friday'],
  ['6', 'admin.saturday'],
];

export default function AdminUsersPage({ administratorsOnly = false, doctorsOnly = false }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const location = useLocation();
  const [filters, setFilters] = useState({
    search: new URLSearchParams(location.search).get('search') || '',
    role: administratorsOnly ? 'admin' : doctorsOnly ? 'doctor' : '',
    status: '',
    district: '',
    phc: '',
    hospital: '',
    sort: 'created_at',
    order: 'desc',
  });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [facilityDirectory, setFacilityDirectory] = useState({ hospitals: [], phcs: [] });
  const [facilitiesLoading, setFacilitiesLoading] = useState(false);
  const [facilitiesLoadError, setFacilitiesLoadError] = useState(false);

  useEffect(() => {
    const search = new URLSearchParams(location.search).get('search') || '';
    setFilters((current) => current.search === search ? current : { ...current, search });
    setPage(1);
  }, [location.search]);

  useEffect(() => {
    if (modal !== 'form' || form.role !== 'doctor') return undefined;
    let active = true;
    setFacilitiesLoading(true);
    setFacilitiesLoadError(false);
    api.get('/appointments', { params: { directory: true } })
      .then(({ data }) => {
        if (active) setFacilityDirectory(data.data.directory);
      })
      .catch(() => {
        if (!active) return;
        setFacilitiesLoadError(true);
        notify(t('admin.facilitiesLoadFailed'), 'error');
      })
      .finally(() => {
        if (active) setFacilitiesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [form.role, modal, notify, t]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/users', {
        params: {
          page,
          limit: 10,
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
    loadUsers();
  }, [loadUsers]);

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const requestErrorMessage = (error) => {
    const messages = {
      ACCOUNT_EXISTS: 'accountExists',
      ADMIN_ID_EXISTS: 'adminIdExists',
      ADMIN_USERNAME_EXISTS: 'adminUsernameExists',
      ADMIN_APPROVAL_REQUIRED: 'adminApprovalRequired',
      FORBIDDEN: 'permissionDenied',
      LAST_SUPER_ADMIN: 'lastSuperAdmin',
      PROFILE_REQUIRED: 'profileRequired',
      DOCTOR_APPROVAL_REQUIRED: 'doctorApprovalRequired',
      SELF_DEACTIVATION: 'selfDeactivation',
      VALIDATION_ERROR: 'validationFailed',
      INVALID_PAGINATION: 'validationFailed',
    };
    return t(`admin.${messages[error.response?.data?.code] || 'saveFailed'}`);
  };
  const updateProfile = (key, value) =>
    setForm((current) => ({
      ...current,
      profile: { ...current.profile, [key]: value },
    }));
  const updateAvailability = (day, value) => {
    updateProfile(
      'availability',
      {
        ...form.profile.availability,
        [day]: value.split(',').map((slot) => slot.trim()).filter(Boolean),
      },
    );
  };
  const startCreate = () => {
    setSelected(null);
    setTemporaryPassword('');
    setForm({
      ...EMPTY_FORM,
      role: administratorsOnly ? 'admin' : 'doctor',
    });
    setModal('form');
  };
  const startEdit = async (item) => {
    try {
      const { data } = await api.get(`/admin/users/${item.id}`);
      const details = data.data;
      setSelected(details);
      setTemporaryPassword('');
      setForm({
        ...EMPTY_FORM,
        full_name: details.full_name,
        mobile: details.mobile,
        email: details.email || '',
        username: details.username || '',
        role: details.role,
        preferred_language: details.preferred_language,
        is_active: details.is_active,
        profile: {
          ...EMPTY_FORM.profile,
          registration_number: details.profile?.registration_number || '',
          qualification: details.profile?.qualification || '',
          worker_code: details.profile?.worker_code || '',
          specialty: details.profile?.specialty || '',
          phc_id: details.profile?.phc_id || '',
          hospital_id: details.profile?.hospital_id || '',
          village_id: details.profile?.village_id || '',
          district: details.profile?.district || '',
          mandal: details.profile?.mandal || '',
          availability: details.profile?.availability || {},
        },
      });
      setModal('form');
    } catch {
      notify(t('admin.loadFailed'), 'error');
    }
  };
  const showDetails = async (item) => {
    try {
      const { data } = await api.get(`/admin/users/${item.id}`);
      setSelected(data.data);
      setModal('details');
    } catch {
      notify(t('admin.loadFailed'), 'error');
    }
  };
  const submitForm = async (event) => {
    event.preventDefault();
    if (!selected && form.role === 'admin' && form.password !== form.confirm_password) {
      notify(t('auth.passwordMismatch'), 'error');
      return;
    }
    const profile = Object.fromEntries(
      Object.entries(form.profile).filter(([key, value]) => (
        (key === 'phc_id' || key === 'hospital_id') && value === null
      ) || (value !== '' && value != null)),
    );
    try {
      if (selected) {
        const payload = {
          full_name: form.full_name,
          mobile: form.mobile,
          email: form.email || null,
          ...(selected.role !== 'patient' ? { role: form.role } : {}),
          preferred_language: form.preferred_language,
          is_active: form.is_active,
          profile,
          reset_password: form.reset_password,
        };
        const { data } = await api.put(`/admin/users/${selected.id}`, payload);
        setTemporaryPassword(data.data.temporaryPassword || '');
      } else {
        const { data } = await api.post('/admin/users', {
          full_name: form.full_name,
          mobile: form.mobile,
          email: form.email || undefined,
          password: form.password,
          role: form.role,
          ...(form.role === 'admin' ? {
            username: form.username,
            admin_id: form.admin_id,
            confirm_password: form.confirm_password,
          } : {}),
          preferred_language: form.preferred_language,
          profile,
        });
        setSelected(data.data);
      }
      await loadUsers();
      notify(t(selected ? 'admin.userUpdated' : 'admin.userCreated'));
    } catch (requestError) {
      notify(requestErrorMessage(requestError), 'error');
    }
  };
  const deactivate = async (item) => {
    if (!window.confirm(t('admin.confirmDelete', { name: item.full_name }))) return;
    try {
      await api.delete(`/admin/users/${item.id}`);
      await loadUsers();
      notify(t('admin.userDeactivated'));
    } catch (requestError) {
      notify(requestErrorMessage(requestError), 'error');
    }
  };
  const reviewDoctor = async (item, decision) => {
    if (
      decision === 'rejected'
      && !window.confirm(t('admin.rejectDoctorConfirm', { name: item.full_name }))
    ) return;
    try {
      const registrationType = item.role === 'admin' ? 'admin' : 'doctor';
      await api.put(`/admin/users/${item.id}/${registrationType}-registration`, { decision });
      await loadUsers();
      notify(t(item.role === 'admin'
        ? decision === 'approved' ? 'admin.adminApproved' : 'admin.adminRejected'
        : decision === 'approved' ? 'admin.doctorApproved' : 'admin.doctorRejected'));
    } catch (requestError) {
      notify(requestErrorMessage(requestError), 'error');
    }
  };
  const downloadReport = async (format) => {
    try {
      const { data, headers } = await api.get('/admin/reports', {
        params: { type: administratorsOnly ? 'users' : 'users', format },
        responseType: 'blob',
      });
      const blob = new Blob([data], { type: headers['content-type'] });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `users-report.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      notify(t('admin.reportFailed'), 'error');
    }
  };

  const roles = ['super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient'];
  const createRoles = administratorsOnly
    ? ['admin']
    : doctorsOnly
    ? ['doctor']
    : user.role === 'super_admin'
      ? roles.filter((role) => role !== 'super_admin')
      : ['doctor', 'health_worker', 'specialist'];
  const columns = [
    { key: 'full_name', header: t('admin.name') },
    ...(administratorsOnly ? [{ key: 'username', header: t('admin.username') }] : []),
    ...(administratorsOnly ? [{ key: 'admin_id', header: t('admin.adminId') }] : []),
    { key: 'mobile', header: t('admin.mobile') },
    { key: 'role', header: t('admin.role') },
    {
      key: 'status',
      header: t('admin.status'),
      render: (row) => t(row.doctor_request_status === 'rejected'
        || row.admin_registration_status === 'rejected'
        ? 'admin.rejected'
        : row.pending_approval
          ? 'admin.pendingApproval'
          : row.is_active ? 'admin.active' : 'admin.inactive'),
    },
    {
      key: 'created_at',
      header: t('admin.registeredAt'),
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: t('admin.actions'),
      render: (row) => (
        <div className="admin-row-actions">
          {row.pending_approval && (
            <>
              <Button
                aria-label={t(row.role === 'admin' ? 'admin.approveAdmin' : 'admin.approveDoctor', { name: row.full_name })}
                onClick={() => reviewDoctor(row, 'approved')}
                variant="outline"
              >
                <Check size={18} />
                {t('admin.approve')}
              </Button>
              <Button
                aria-label={t(row.role === 'admin' ? 'admin.rejectAdmin' : 'admin.rejectDoctor', { name: row.full_name })}
                onClick={() => reviewDoctor(row, 'rejected')}
                variant="outline"
              >
                <X size={18} />
                {t('admin.reject')}
              </Button>
            </>
          )}
          <Button
            aria-label={t('admin.viewUser', { name: row.full_name })}
            onClick={() => showDetails(row)}
            variant="ghost"
          >
            <Eye size={18} />
          </Button>
          {(user.role === 'super_admin' || !['admin', 'super_admin'].includes(row.role)) && (
            <>
              <Button
                aria-label={t('admin.editUser', { name: row.full_name })}
                onClick={() => startEdit(row)}
                variant="ghost"
              >
                <Pencil size={18} />
              </Button>
              <Button
                aria-label={t('admin.deleteUser', { name: row.full_name })}
                onClick={() => deactivate(row)}
                variant="ghost"
              >
                <Trash2 size={18} />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const title = administratorsOnly
    ? t('admin.manageAdministrators')
    : doctorsOnly
      ? t('admin.doctorManagement')
      : t('admin.userManagement');
  if (loading && !result) return <Loading />;
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('admin.administration')}</p>
          <h1>{title}</h1>
        </div>
        <div className="admin-actions">
          {!administratorsOnly && !doctorsOnly && (
            <>
              <Button onClick={() => downloadReport('csv')} variant="outline">
                <FileDown size={18} />
                {t('admin.exportCsv')}
              </Button>
              <Button onClick={() => downloadReport('pdf')} variant="outline">
                <FileDown size={18} />
                {t('admin.exportPdf')}
              </Button>
            </>
          )}
          <Button onClick={startCreate}>
            <Plus size={18} />
            {t(administratorsOnly
              ? 'admin.createAdminAccount'
              : doctorsOnly ? 'admin.registerDoctor' : 'admin.addUser')}
          </Button>
          {administratorsOnly && (
            <Link className="button button--outline" to="/admin-registration">
              {t('admin.adminRegistrationTitle')}
            </Link>
          )}
        </div>
      </div>
      <Card className="admin-filter-card">
        <Input
          id="user-search"
          label={t('admin.searchUsers')}
          onChange={(event) => {
            setFilters({ ...filters, search: event.target.value });
            setPage(1);
          }}
          value={filters.search}
        />
        {!administratorsOnly && !doctorsOnly && (
          <Select
            id="user-role-filter"
            label={t('admin.role')}
            onChange={(event) => {
              setFilters({ ...filters, role: event.target.value });
              setPage(1);
            }}
            value={filters.role}
          >
            <option value="">{t('admin.allRoles')}</option>
            {roles.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </Select>
        )}
        <Select
          id="user-status-filter"
          label={t('admin.status')}
          onChange={(event) => {
            setFilters({ ...filters, status: event.target.value });
            setPage(1);
          }}
          value={filters.status}
        >
          <option value="">{t('admin.allStatuses')}</option>
          <option value="pending">{t('admin.pendingApproval')}</option>
          <option value="rejected">{t('admin.rejected')}</option>
          <option value="active">{t('admin.active')}</option>
          <option value="inactive">{t('admin.inactive')}</option>
        </Select>
        <Input
          id="user-district-filter"
          label={t('admin.districtFilter')}
          onChange={(event) => {
            setFilters({ ...filters, district: event.target.value });
            setPage(1);
          }}
          value={filters.district}
        />
        <Input
          id="user-phc-filter"
          label={t('admin.phcFilter')}
          onChange={(event) => {
            setFilters({ ...filters, phc: event.target.value });
            setPage(1);
          }}
          value={filters.phc}
        />
        <Input
          id="user-hospital-filter"
          label={t('admin.hospitalFilter')}
          onChange={(event) => {
            setFilters({ ...filters, hospital: event.target.value });
            setPage(1);
          }}
          value={filters.hospital}
        />
        <Select
          id="user-sort"
          label={t('admin.sortBy')}
          onChange={(event) => setFilters({ ...filters, sort: event.target.value })}
          value={filters.sort}
        >
          <option value="created_at">{t('admin.registeredAt')}</option>
          <option value="name">{t('admin.name')}</option>
          <option value="role">{t('admin.role')}</option>
          <option value="status">{t('admin.status')}</option>
        </Select>
        <Select
          id="user-sort-order"
          label={t('admin.sortOrder')}
          onChange={(event) => setFilters({ ...filters, order: event.target.value })}
          value={filters.order}
        >
          <option value="desc">{t('admin.descending')}</option>
          <option value="asc">{t('admin.ascending')}</option>
        </Select>
      </Card>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <Card className="admin-table-card">
        <Table columns={columns} rows={result?.data?.items || []} />
        <Pagination
          page={result?.meta?.page || page}
          totalPages={result?.meta?.totalPages || 1}
          onPageChange={setPage}
        />
      </Card>

      <Modal
        onClose={() => setModal('')}
        open={modal === 'form'}
        title={
          selected
            ? t('admin.editUserTitle')
            : t(administratorsOnly
              ? 'admin.createAdminAccount'
              : doctorsOnly ? 'admin.registerDoctor' : 'admin.createUserTitle')
        }
      >
        <form className="admin-form" onSubmit={submitForm}>
          <Input
            id="admin-user-name"
            label={t('admin.name')}
            onChange={(event) => updateForm('full_name', event.target.value)}
            required
            value={form.full_name}
          />
          <Input
            id="admin-user-mobile"
            inputMode="numeric"
            label={t('admin.mobile')}
            maxLength={10}
            onChange={(event) => updateForm('mobile', event.target.value)}
            required
            value={form.mobile}
          />
          <Input
            id="admin-user-email"
            label={t('admin.email')}
            onChange={(event) => updateForm('email', event.target.value)}
            required={administratorsOnly && !selected}
            type="email"
            value={form.email}
          />
          {administratorsOnly && !selected && (
            <Input
              autoComplete="username"
              id="admin-account-username"
              label={t('admin.username')}
              maxLength={32}
              minLength={3}
              onChange={(event) => updateForm('username', event.target.value)}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"
              required
              value={form.username}
            />
          )}
          {administratorsOnly && !selected && (
            <Input
              autoComplete="off"
              id="admin-account-id"
              label={t('admin.adminId')}
              maxLength={32}
              onChange={(event) => updateForm('admin_id', event.target.value)}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"
              required
              value={form.admin_id}
            />
          )}
          <Select
            disabled={administratorsOnly || doctorsOnly || selected?.role === 'patient'}
            id="admin-user-role"
            label={t('admin.role')}
            onChange={(event) => updateForm('role', event.target.value)}
            value={form.role}
          >
            {(selected ? [...new Set([form.role, ...createRoles])] : createRoles).map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </Select>
          {!selected && (
            <>
              <Input
                autoComplete="new-password"
                id="admin-user-password"
                label={t('admin.initialPassword')}
                onChange={(event) => updateForm('password', event.target.value)}
                required
                type="password"
                value={form.password}
              />
              <p className="auth-hint">{t('auth.passwordPolicy')}</p>
              {form.role === 'admin' && (
                <Input
                  autoComplete="new-password"
                  id="admin-user-confirm-password"
                  label={t('auth.confirmPassword')}
                  onChange={(event) => updateForm('confirm_password', event.target.value)}
                  required
                  type="password"
                  value={form.confirm_password}
                />
              )}
              {administratorsOnly && selected && (
                <Input
                  autoComplete="username"
                  id="admin-account-username"
                  label={t('admin.username')}
                  readOnly
                  value={form.username}
                />
              )}
            </>
          )}
          {['doctor', 'specialist'].includes(form.role) && (
            <Input
              id="admin-registration-number"
              label={t('admin.registrationNumber')}
              onChange={(event) => updateProfile('registration_number', event.target.value)}
              required
              value={form.profile.registration_number}
            />
          )}
          {form.role === 'doctor' && (
            <Input
              id="admin-qualification"
              label={t('admin.qualification')}
              onChange={(event) => updateProfile('qualification', event.target.value)}
              value={form.profile.qualification}
            />
          )}
          {form.role === 'doctor' && !facilitiesLoadError && (
            <>
              <Select
                disabled={facilitiesLoading}
                id="admin-doctor-hospital"
                label={t('admin.assignedHospital')}
                onChange={(event) => updateProfile('hospital_id', event.target.value || null)}
                value={form.profile.hospital_id || ''}
              >
                <option value="">{t('admin.noHospitalAssigned')}</option>
                {facilityDirectory.hospitals.map((facility) => (
                  <option key={facility.id} value={facility.id}>{facility.name}</option>
                ))}
              </Select>
              <Select
                disabled={facilitiesLoading}
                id="admin-doctor-phc"
                label={t('admin.assignedPhc')}
                onChange={(event) => updateProfile('phc_id', event.target.value || null)}
                value={form.profile.phc_id || ''}
              >
                <option value="">{t('admin.noPhcAssigned')}</option>
                {facilityDirectory.phcs.map((facility) => (
                  <option key={facility.id} value={facility.id}>{facility.name}</option>
                ))}
              </Select>
            </>
          )}
          {form.role === 'doctor' && facilitiesLoading && (
            <p className="auth-hint" role="status">{t('phase8.loading')}</p>
          )}
          {form.role === 'doctor' && facilitiesLoadError && (
            <p className="auth-error" role="alert">{t('admin.facilitiesLoadFailed')}</p>
          )}
          {form.role === 'doctor' && (
            <fieldset className="admin-availability">
              <legend>{t('admin.doctorAvailability')}</legend>
              <p className="auth-hint">{t('admin.doctorAvailabilityHint')}</p>
              {AVAILABILITY_DAYS.map(([day, label]) => (
                <Input
                  id={`admin-doctor-availability-${day}`}
                  key={day}
                  label={t(label)}
                  onChange={(event) => updateAvailability(day, event.target.value)}
                  placeholder="09:00, 09:30"
                  value={(form.profile.availability?.[day] || []).join(', ')}
                />
              ))}
            </fieldset>
          )}
          {form.role === 'health_worker' && (
            <Input
              id="admin-worker-code"
              label={t('admin.workerCode')}
              onChange={(event) => updateProfile('worker_code', event.target.value)}
              required
              value={form.profile.worker_code}
            />
          )}
          {form.role === 'specialist' && (
            <Input
              id="admin-specialty"
              label={t('admin.specialty')}
              onChange={(event) => updateProfile('specialty', event.target.value)}
              required
              value={form.profile.specialty}
            />
          )}
          {selected && (
            <>
              <label className="admin-checkbox">
                <input
                  checked={form.is_active}
                  onChange={(event) => updateForm('is_active', event.target.checked)}
                  type="checkbox"
                />
                {t('admin.active')}
              </label>
              <label className="admin-checkbox">
                <input
                  checked={form.reset_password}
                  onChange={(event) => updateForm('reset_password', event.target.checked)}
                  type="checkbox"
                />
                {t('admin.resetPassword')}
              </label>
            </>
          )}
          {temporaryPassword && (
            <p className="auth-success" role="status">
              {t('admin.temporaryPassword')}: <strong>{temporaryPassword}</strong>
            </p>
          )}
          <p className="auth-hint">{t('admin.rolePermissionsNote')}</p>
          <div className="admin-actions">
            <Button type="submit">
              {selected
                ? t('admin.saveChanges')
                : t(doctorsOnly ? 'admin.registerDoctor' : 'admin.createUser')}
            </Button>
            <Button onClick={() => setModal('')} type="button" variant="outline">
              {t('cancel')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        onClose={() => setModal('')}
        open={modal === 'details'}
        title={t('admin.registrationHistory')}
      >
        {selected && (
          <div className="admin-details">
            <p>
              <strong>{selected.full_name}</strong> · {t(`roles.${selected.role}`)}
            </p>
            <p>
              {t('admin.registeredBy')}: {selected.created_by || t('admin.unknown')}
            </p>
            <p>
              {t('admin.effectivePermissions')}: {(selected.permissions || []).join(', ') || '—'}
            </p>
            <h3>{t('admin.registrationHistory')}</h3>
            <Table
              columns={[
                { key: 'action', header: t('admin.action') },
                { key: 'created_by', header: t('admin.actor') },
                {
                  key: 'created_at',
                  header: t('admin.date'),
                  render: (row) => new Date(row.created_at).toLocaleString(),
                },
              ]}
              rows={selected.registrationHistory || []}
            />
            <h3>{t('admin.recentActivity')}</h3>
            <Table
              columns={[
                { key: 'action', header: t('admin.action') },
                { key: 'actor_name', header: t('admin.actor') },
                {
                  key: 'created_at',
                  header: t('admin.date'),
                  render: (row) => new Date(row.created_at).toLocaleString(),
                },
              ]}
              rows={selected.recentActivity || []}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
