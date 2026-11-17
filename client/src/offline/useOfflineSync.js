import { useCallback, useEffect } from 'react';
import { useToast } from '../components/ui/Toast.jsx';
import { useTranslation } from 'react-i18next';
import api from '../services/api.js';
import { getQueuedScreenings, syncQueuedScreenings } from './screeningQueue.js';

export default function useOfflineSync(enabled) {
  const { t } = useTranslation();
  const { notify } = useToast();

  const sync = useCallback(
    async (force = false) => {
      try {
        const summary = { screenings: await syncQueuedScreenings(api, { force }) };
        window.dispatchEvent(new CustomEvent('aarogya:offline-queue-updated', { detail: summary }));
        return summary;
      } catch {
        notify(t('patient.syncError'), 'error');
        window.dispatchEvent(
          new CustomEvent('aarogya:offline-queue-error', { detail: { message: 'sync' } }),
        );
        return null;
      }
    },
    [notify, t],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let retryTimer;

    const syncWhenOnline = () => {
      if (navigator.onLine && active) void sync(false);
    };
    const scheduleRetry = async () => {
      window.clearTimeout(retryTimer);
      try {
        const screenings = await getQueuedScreenings();
        const dates = screenings
          .filter((item) => item.status === 'pending' && item.next_retry_at)
          .map((item) => new Date(item.next_retry_at).getTime())
          .filter((value) => Number.isFinite(value));
        if (dates.length && active && navigator.onLine) {
          const delay = Math.max(1000, Math.min(...dates) - Date.now());
          retryTimer = window.setTimeout(syncWhenOnline, delay);
        }
      } catch {
        if (active) notify(t('patient.syncError'), 'error');
      }
    };
    const handleUpdated = () => void scheduleRetry();
    const handleManualSync = () => void sync(true);
    window.addEventListener('online', syncWhenOnline);
    window.addEventListener('aarogya:offline-queue-updated', handleUpdated);
    window.addEventListener('aarogya:offline-queue-sync-request', handleManualSync);
    syncWhenOnline();
    void scheduleRetry();
    return () => {
      active = false;
      window.removeEventListener('online', syncWhenOnline);
      window.removeEventListener('aarogya:offline-queue-updated', handleUpdated);
      window.removeEventListener('aarogya:offline-queue-sync-request', handleManualSync);
      window.clearTimeout(retryTimer);
    };
  }, [enabled, notify, sync, t]);

  return sync;
}
