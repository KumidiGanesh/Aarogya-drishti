import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ClipboardPlus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import AiOutputBanner from '../components/screenings/AiOutputBanner.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Loading from '../components/ui/Loading.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import Select from '../components/ui/Select.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';
import { getQueuedScreenings, syncQueuedScreenings } from '../offline/screeningQueue.js';

const LIST_ROLES = ['health_worker', 'doctor', 'specialist', 'admin', 'super_admin', 'patient'];

export default function ScreeningListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const search = new URLSearchParams(location.search).get('search')?.trim() || '';
  const { notify } = useToast();
  const [items, setItems] = useState([]);
  const [doctorRequests, setDoctorRequests] = useState([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [queued, setQueued] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const canCreate = ['doctor', 'health_worker'].includes(user.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [screeningsResult, requestsResult] = await Promise.all([
        api.get('/screenings', {
          params: {
            page,
            limit: 20,
            ...(status ? { status } : {}),
            ...(search ? { search } : {}),
          },
        }),
        user.role === 'doctor'
          ? api.get('/screenings/doctor-requests')
          : Promise.resolve({ data: { data: { items: [] } } }),
      ]);
      setItems(screeningsResult.data.data.items || []);
      setMeta(screeningsResult.data.meta);
      setDoctorRequests(requestsResult.data.data.items || []);
    } catch {
      notify(t('screening.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, page, search, status, t, user.role]);

  const loadQueue = useCallback(async () => {
    try {
      setQueued(await getQueuedScreenings());
    } catch {
      notify(t('patient.syncError'), 'error');
    }
  }, [notify, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadQueue();
    const handleQueueChange = () => void loadQueue();
    window.addEventListener('aarogya:offline-queue-updated', handleQueueChange);
    return () => window.removeEventListener('aarogya:offline-queue-updated', handleQueueChange);
  }, [loadQueue]);

  const syncQueue = async () => {
    if (!navigator.onLine) {
      notify(t('screening.unavailable'), 'error');
      return;
    }
    setSyncing(true);
    try {
      const summary = await syncQueuedScreenings(api, { force: true });
      window.dispatchEvent(new CustomEvent('aarogya:offline-queue-updated', { detail: summary }));
      await Promise.all([loadQueue(), load()]);
      if (summary.failed || summary.conflicts || summary.pending) {
        notify(t('screening.syncFailed'), 'error');
      } else {
        notify(t('screening.completedScreening'), 'success');
      }
    } catch {
      notify(t('screening.syncFailed'), 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="screening-page">
      <header className="page-heading screening-heading">
        <div>
          <p className="eyebrow">{t('screening.title')}</p>
          <h1>{t('screening.historyTitle')}</h1>
          <p className="page-heading__description">{t('screening.description')}</p>
          {search && <p className="page-heading__description">Search results for “{search}”</p>}
        </div>
        {canCreate && (
          <Link className="button button--primary" to="/screenings/new">
            <ClipboardPlus aria-hidden="true" size={19} />
            {t('screening.start')}
          </Link>
        )}
      </header>
      {user.role === 'health_worker' && (
        <Card className="screening-queue">
          <div>
            <h2>{t('screening.syncQueued')}</h2>
            <p>{queued.length ? `${queued.length}` : t('screening.queueEmpty')}</p>
          </div>
          <Button
            disabled={!queued.length || syncing || !navigator.onLine}
            onClick={() => void syncQueue()}
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" size={18} />
            {syncing ? t('loading') : t('screening.syncNow')}
          </Button>
        </Card>
      )}
      {!!queued.length && (
        <Card className="screening-queue-items">
          {queued.map((item) => (
            <div className="screening-queue-item" key={item.client_uuid}>
              <span>{new Date(item.created_at).toLocaleString()}</span>
              <strong>{t(`screening.${item.status}`)}</strong>
              {item.last_error && <span>{item.last_error}</span>}
            </div>
          ))}
        </Card>
      )}
      {user.role === 'doctor' && (
        <Card className="screening-queue">
          <h2>{t('screening.doctorRequests')}</h2>
          {doctorRequests.length ? (
            <div className="screening-history-list">
              {doctorRequests.map((request) => (
                <div className="screening-queue-item" key={request.id}>
                  <div>
                    <strong>{request.patient_name}</strong>
                    <span>{request.patient_code}</span>
                  </div>
                  <span>{t(`screening.doctorRequestStatuses.${request.status}`)}</span>
                  <Link className="button button--outline" to={`/screenings/${request.screening_id}`}>
                    {t('screening.view')}
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p>{t('screening.noDoctorRequests')}</p>
          )}
        </Card>
      )}
      <Card className="screening-filters">
        <Select
          id="screening-filter-status"
          label={t('screening.status')}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          value={status}
        >
          <option value="">{t('screening.all')}</option>
          {[
            'draft',
            'pending',
            'images_uploaded',
            'ai_completed',
            'analysis_failed',
            'in_review',
            'reviewed',
            'referred',
            'closed',
          ].map((value) => (
            <option key={value} value={value}>
              {t(`screening.${value}`, value.replaceAll('_', ' '))}
            </option>
          ))}
        </Select>
      </Card>
      {loading ? (
        <Loading label={t('loading')} />
      ) : items.length ? (
        <>
          <div className="screening-history-list">
            {items.map((item) => (
              <Card className="screening-history-card" key={item.id}>
                <div className="screening-history-card__header">
                  <div>
                    <strong>{item.patient_name || t('screening.patient')}</strong>
                    <span>{item.patient_code}</span>
                  </div>
                  <span className={`screening-status screening-status--${item.status}`}>
                    {t(`screening.${item.status}`, item.status.replaceAll('_', ' '))}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>{t('screening.date')}</dt>
                    <dd>{new Date(item.screened_at || item.created_at).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>{t('screening.inferenceStatus')}</dt>
                    <dd>
                      {t(`screening.inferenceStatuses.${item.inference_status || 'unknown'}`)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('screening.patientStep')}</dt>
                    <dd>
                      {[item.village_name, item.phc_name].filter(Boolean).join(' · ') ||
                        t('patient.none')}
                    </dd>
                  </div>
                </dl>
                {item.is_demo ? (
                  <AiOutputBanner compact isDemo />
                ) : (
                  item.inference_status && (
                    <AiOutputBanner compact isFailed={item.inference_status === 'failed'} />
                  )
                )}
                <Link className="button button--outline" to={`/screenings/${item.id}`}>
                  {t('screening.view')}
                </Link>
              </Card>
            ))}
          </div>
          <Pagination onPageChange={setPage} page={meta.page} totalPages={meta.totalPages} />
        </>
      ) : (
        <Card className="screening-empty">
          <ClipboardPlus aria-hidden="true" size={28} />
          <p>{t('screening.noScreenings')}</p>
        </Card>
      )}
      <p className="screening-translation-notice">{t('screening.translationNotice')}</p>
    </div>
  );
}
