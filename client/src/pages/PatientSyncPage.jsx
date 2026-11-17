import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { roleDashboardPath } from '../auth/roles.js';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Loading from '../components/ui/Loading.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';
import {
  getQueuedRegistrations,
  removeQueuedRegistration,
  syncQueuedRegistrations,
  updateQueuedRegistration,
} from '../offline/queue.js';

export default function PatientSyncPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [justifications, setJustifications] = useState({});
  const [loading, setLoading] = useState(true);
  const [credentials, setCredentials] = useState([]);
  const dashboardPath = roleDashboardPath[user?.role] || '/';

  const refresh = useCallback(async () => {
    try {
      setItems(await getQueuedRegistrations());
    } catch {
      notify(t('patient.syncError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  useEffect(() => {
    void refresh();
    const handleUpdate = () => void refresh();
    const handleError = () => notify(t('patient.syncFailed'), 'error');
    window.addEventListener('aarogya:offline-queue-updated', handleUpdate);
    window.addEventListener('aarogya:offline-queue-error', handleError);
    return () => {
      window.removeEventListener('aarogya:offline-queue-updated', handleUpdate);
      window.removeEventListener('aarogya:offline-queue-error', handleError);
    };
  }, [notify, refresh, t]);

  const syncNow = async () => {
    setBusy(true);
    try {
      const result = await syncQueuedRegistrations(api, { force: true });
      setCredentials(result.credentials);
      await refresh();
    } catch {
      notify(t('patient.syncFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmCredentialHandoff = async (clientUuid) => {
    try {
      await removeQueuedRegistration(clientUuid);
      setCredentials((items) => items.filter((item) => item.client_uuid !== clientUuid));
      await refresh();
    } catch {
      notify(t('patient.syncError'), 'error');
    }
  };

  const createAnyway = async (item) => {
    const reason = (justifications[item.client_uuid] || '').trim();
    if (reason.length < 10) {
      notify(t('patient.createReasonRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      await updateQueuedRegistration(item.client_uuid, {
        status: 'pending',
        payload: { ...item.payload, force: true, justification: reason },
        candidates: [],
        next_retry_at: null,
      });
      const result = await syncQueuedRegistrations(api, { force: true });
      setCredentials(result.credentials);
      await refresh();
    } catch {
      notify(t('patient.syncFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const goToExistingRecord = async (item, candidate) => {
    if (!candidate) return;
    try {
      await removeQueuedRegistration(item.client_uuid);
      await refresh();
      window.location.assign(`/patients/${candidate.id}`);
    } catch {
      notify(t('patient.syncError'), 'error');
    }
  };

  const statusLabel = (status) => t(`patient.${status === 'conflict' ? 'conflict' : status}`);
  if (loading) return <Loading label={t('patient.loading')} />;

  return (
    <div className="patient-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('patient.management')}</p>
          <h1>{t('patient.syncStatus')}</h1>
          <p className="page-heading__description">{t('patient.retrying')}</p>
        </div>
        <Button disabled={busy || !navigator.onLine} onClick={syncNow} type="button">
          <RefreshCw aria-hidden="true" size={18} />
          {t('patient.syncNow')}
        </Button>
      </div>
      <Card className="patient-sync-list">
        {items.length === 0 ? (
          <p>{t('patient.noQueuedItems')}</p>
        ) : (
          items.map((item) => (
            <section className="patient-sync-item" key={item.client_uuid}>
              <div>
                <strong>{item.payload.full_name}</strong>
                <span>{statusLabel(item.status)}</span>
                {item.last_error && <small>{t('patient.accountConflict')}</small>}
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </div>
              <Button
                aria-label={t('patient.remove')}
                disabled={busy || item.status === 'credentials_ready'}
                onClick={async () => {
                  try {
                    await removeQueuedRegistration(item.client_uuid);
                    await refresh();
                  } catch {
                    notify(t('patient.syncError'), 'error');
                  }
                }}
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" size={18} />
              </Button>
              {item.status === 'conflict' && (
                <div className="patient-conflict-review">
                  {(item.candidates || []).map((candidate) => (
                    <div className="patient-sync-candidate" key={candidate.id}>
                      <strong>{candidate.patient_code}</strong>
                      <span>{candidate.full_name}</span>
                      <span>{candidate.village_name}</span>
                      <Button
                        onClick={() => void goToExistingRecord(item, candidate)}
                        type="button"
                        variant="outline"
                      >
                        {t('patient.useExisting')}
                      </Button>
                    </div>
                  ))}
                  <Input
                    id={`reason-${item.client_uuid}`}
                    label={t('patient.justification')}
                    minLength="10"
                    onChange={(event) =>
                      setJustifications((current) => ({
                        ...current,
                        [item.client_uuid]: event.target.value,
                      }))
                    }
                    value={justifications[item.client_uuid] || ''}
                  />
                  <Button disabled={busy} onClick={() => void createAnyway(item)} type="button">
                    {t('patient.createAnyway')}
                  </Button>
                </div>
              )}
            </section>
          ))
        )}
      </Card>
      {credentials.map(({ client_uuid: clientUuid, patient, temporary_password: password }) => (
        <Card className="patient-temporary-credentials" key={clientUuid} role="alert">
          <h2>{t('patient.temporaryPasswordTitle')}</h2>
          <p>{t('patient.registrationSaved', { code: patient.patient_code })}</p>
          <p>{t('patient.temporaryPasswordInstructions')}</p>
          <output>{password}</output>
          <Button onClick={() => void confirmCredentialHandoff(clientUuid)} type="button">
            {t('patient.credentialSaved')}
          </Button>
        </Card>
      ))}
      <p className="patient-demo-safety">{t('demoNotice')}</p>
      <Link className="patient-back-link" to={dashboardPath}>
        {t('dashboard')}
      </Link>
    </div>
  );
}
