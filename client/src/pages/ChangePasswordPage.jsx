import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import VoiceGuidanceToggle from '../components/VoiceGuidanceToggle.jsx';

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const { changePassword } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ next: '', confirm: '' });
  const [visible, setVisible] = useState({ next: false, confirm: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (key) => (event) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await changePassword(values.next, values.confirm);
      navigate('/', { replace: true });
    } catch {
      setError(t('auth.changePasswordFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section aria-labelledby="forced-password-title" className="auth-card">
        <h1 id="forced-password-title">{t('auth.changePasswordTitle')}</h1>
        <p className="auth-description">{t('auth.changePasswordRequired')}</p>
        <VoiceGuidanceToggle />
        <form className="auth-form" onSubmit={submit}>
          {[
            { key: 'next', id: 'next-password', label: t('auth.newPassword') },
            { key: 'confirm', id: 'confirm-next-password', label: t('auth.confirmPassword') },
          ].map(({ key, id, label }) => (
            <div className="password-field" key={key}>
              <Input
                autoComplete="new-password"
                id={id}
                label={label}
                onChange={update(key)}
                required
                type={visible[key] ? 'text' : 'password'}
                value={values[key]}
              />
              <button
                aria-label={visible[key] ? t('auth.hidePassword') : t('auth.showPassword')}
                className="password-toggle"
                onClick={() => setVisible((current) => ({ ...current, [key]: !current[key] }))}
                type="button"
              >
                {visible[key] ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          ))}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <Button className="auth-submit" disabled={busy}>
            {busy ? t('loading') : t('auth.updatePassword')}
          </Button>
        </form>
      </section>
    </main>
  );
}
