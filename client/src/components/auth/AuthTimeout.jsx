import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext.jsx';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const WARNING_BEFORE_MS = 60 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'];

export default function AuthTimeout() {
  const { t } = useTranslation();
  const { user, logout, refresh } = useAuth();
  const [warningOpen, setWarningOpen] = useState(false);

  useEffect(() => {
    if (!user) return undefined;
    let warningTimer;
    let logoutTimer;
    const resetTimers = () => {
      window.clearTimeout(warningTimer);
      window.clearTimeout(logoutTimer);
      setWarningOpen(false);
      warningTimer = window.setTimeout(() => setWarningOpen(true), IDLE_TIMEOUT_MS - WARNING_BEFORE_MS);
      logoutTimer = window.setTimeout(() => logout(), IDLE_TIMEOUT_MS);
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimers, { passive: true });
    }
    resetTimers();
    return () => {
      window.clearTimeout(logoutTimer);
      window.clearTimeout(warningTimer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, resetTimers);
    };
  }, [user, logout]);

  const continueSession = async () => {
    try {
      await refresh();
      setWarningOpen(false);
    } catch {
      await logout();
    }
  };

  if (!user) return null;
  return (
    <Modal
      onClose={continueSession}
      open={warningOpen}
      title={t('auth.sessionWarning')}
    >
      <p>{t('auth.sessionWarningBody')}</p>
      <div className="auth-actions">
        <Button onClick={continueSession}>{t('auth.continueSession')}</Button>
        <Button onClick={logout} variant="outline">{t('auth.logout')}</Button>
      </div>
    </Modal>
  );
}
