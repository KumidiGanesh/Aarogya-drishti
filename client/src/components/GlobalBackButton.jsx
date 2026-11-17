import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { roleDashboardPath } from '../auth/roles.js';

const workspaceRoots = ['/patient', '/doctor', '/health-worker', '/specialist', '/admin', '/super-admin', '/appointments', '/consultations', '/notifications', '/settings', '/screenings', '/medicines', '/emergency', '/patients'];

export default function GlobalBackButton() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  if (location.pathname === '/') return null;
  if (user?.role === 'doctor') return null;
  const isWorkspace = workspaceRoots.some((root) => location.pathname === root || location.pathname.startsWith(`${root}/`));

  const goBack = () => {
    const previous = window.history.state?.idx;
    if (typeof previous === 'number' && previous > 0) {
      navigate(-1);
      return;
    }
    const returnPath = location.state?.from?.pathname;
    if (returnPath && returnPath !== location.pathname) {
      navigate(`${returnPath}${location.state?.from?.search || ''}`, { replace: true });
      return;
    }
    navigate(user ? roleDashboardPath[user.role] || '/' : '/');
  };

  return (
    <button
      aria-label={t('back')}
      className={`global-back-button${isWorkspace ? ' global-back-button--workspace' : ''}`}
      onClick={goBack}
      title={t('back')}
      type="button"
    >
      <ArrowLeft aria-hidden="true" size={19} />
      <span>{t('back')}</span>
    </button>
  );
}
