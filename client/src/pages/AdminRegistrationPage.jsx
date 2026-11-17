import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Loading from '../components/ui/Loading.jsx';
import Select from '../components/ui/Select.jsx';
import api from '../services/api.js';

const initialForm = {
  full_name: '',
  email: '',
  mobile: '',
  username: '',
  password: '',
  confirm_password: '',
};

export default function AdminRegistrationPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (!user) {
    return (
      <main className="admin-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{t('admin.administration')}</p>
            <h1>{t('admin.adminRegistrationTitle')}</h1>
          </div>
        </div>
        <Card>
          <p>{t('admin.adminRegistrationLoginRequired')}</p>
          <Link
            className="button"
            state={{ from: { pathname: '/admin-registration' } }}
            to="/login"
          >
            {t('auth.adminLogin')}
          </Link>
        </Card>
      </main>
    );
  }
  if (user.role !== 'super_admin' || !user.permissions?.includes('users:manage')) {
    return (
      <main className="admin-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{t('admin.administration')}</p>
            <h1>{t('admin.adminRegistrationTitle')}</h1>
          </div>
        </div>
        <Card><p className="auth-error" role="alert">{t('admin.adminRegistrationUnauthorized')}</p></Card>
      </main>
    );
  }
  const update = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (form.password !== form.confirm_password) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/admin/users', {
        ...form,
        email: form.email.trim().toLowerCase(),
        username: form.username.trim().toLowerCase(),
        role: 'admin',
        preferred_language: user.preferred_language || 'en',
        profile: {},
      });
      setCreated(true);
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      const message = {
        ADMIN_USERNAME_EXISTS: 'adminUsernameExists',
        ADMIN_ID_EXISTS: 'adminIdExists',
        ACCOUNT_EXISTS: 'accountExists',
        FORBIDDEN: 'permissionDenied',
        VALIDATION_ERROR: 'validationFailed',
      }[code] || 'adminRegistrationFailed';
      setError(t(`admin.${message}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('admin.administration')}</p>
          <h1>{t('admin.adminRegistrationTitle')}</h1>
          <p>{t('admin.adminRegistrationDescription')}</p>
        </div>
        <Link className="button button--outline" to="/admin/administrators">
          {t('admin.manageAdministrators')}
        </Link>
      </div>
      <Card>
        {created ? (
          <div className="auth-form">
            <p className="auth-success" role="status">{t('admin.adminRegistrationPending')}</p>
            <Button onClick={() => navigate('/admin/administrators')}>
              {t('admin.manageAdministrators')}
            </Button>
          </div>
        ) : (
          <form className="admin-form" onSubmit={submit}>
            <Input
              autoComplete="name"
              id="new-admin-full-name"
              label={t('admin.name')}
              maxLength={160}
              onChange={update('full_name')}
              required
              value={form.full_name}
            />
            <Input
              autoComplete="email"
              id="new-admin-email"
              label={t('admin.email')}
              onChange={update('email')}
              required
              type="email"
              value={form.email}
            />
            <Input
              autoComplete="tel-national"
              id="new-admin-mobile"
              inputMode="numeric"
              label={t('admin.mobile')}
              maxLength={10}
              onChange={update('mobile')}
              pattern="[6-9][0-9]{9}"
              required
              value={form.mobile}
            />
            <Input
              autoComplete="username"
              id="new-admin-username"
              label={t('admin.username')}
              maxLength={32}
              minLength={3}
              onChange={update('username')}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"
              required
              value={form.username}
            />
            <Select id="new-admin-role" label={t('admin.role')} value="admin" disabled>
              <option value="admin">{t('roles.admin')}</option>
            </Select>
            <Input
              autoComplete="new-password"
              id="new-admin-password"
              label={t('admin.initialPassword')}
              minLength={8}
              onChange={update('password')}
              pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}"
              required
              type="password"
              value={form.password}
            />
            <Input
              autoComplete="new-password"
              id="new-admin-confirm-password"
              label={t('auth.confirmPassword')}
              minLength={8}
              onChange={update('confirm_password')}
              required
              type="password"
              value={form.confirm_password}
            />
            <p className="auth-hint">{t('auth.passwordPolicy')}</p>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <div className="admin-actions">
              <Button disabled={busy}>
                {busy ? t('loading') : t('admin.createAdminAccount')}
              </Button>
              <Button onClick={() => navigate('/admin/administrators')} type="button" variant="outline">
                {t('cancel')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </main>
  );
}
