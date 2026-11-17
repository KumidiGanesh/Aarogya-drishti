import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Loading from '../components/ui/Loading.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import AiOutputBanner from '../components/screenings/AiOutputBanner.jsx';

const CONSENTS = ['data_collection', 'aadhaar_documents', 'photo', 'location', 'teleconsultation', 'ai_processing'];

function formatConsentDate(value, locale) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function PatientProfilePage({ patientId: suppliedPatientId }) {
  const { id: routeId } = useParams();
  const patientId = suppliedPatientId || routeId;
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const [patient, setPatient] = useState(null);
  const [tab, setTab] = useState('overview');
  const [timeline, setTimeline] = useState({ items: [], meta: null });
  const [timelinePage, setTimelinePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [researchConsent, setResearchConsent] = useState(null);
  const [researchConsentLoading, setResearchConsentLoading] = useState(false);
  const [researchConsentSaving, setResearchConsentSaving] = useState(false);
  const [researchConsentAccepted, setResearchConsentAccepted] = useState(false);

  const loadPatient = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/patients/${patientId}`);
      setPatient(data.data.patient);
    } catch {
      notify(t('patient.registrationError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, patientId, t]);

  const loadTimeline = useCallback(async () => {
    try {
      const { data } = await api.get(`/patients/${patientId}/history`, {
        params: { page: timelinePage, limit: 20 },
      });
      setTimeline({ items: data.data.items, meta: data.meta });
    } catch {
      notify(t('patient.registrationError'), 'error');
    }
  }, [notify, patientId, timelinePage, t]);

  const loadResearchConsent = useCallback(async () => {
    if (user.role !== 'patient') return;
    setResearchConsentLoading(true);
    try {
      const { data } = await api.get('/research/consent');
      setResearchConsent(data.data);
    } catch {
      setResearchConsent(null);
      notify(t('patient.researchConsentLoadFailed'), 'error');
    } finally {
      setResearchConsentLoading(false);
    }
  }, [notify, t, user.role]);

  useEffect(() => {
    void loadPatient();
  }, [loadPatient]);
  useEffect(() => {
    void loadResearchConsent();
  }, [loadResearchConsent]);
  useEffect(() => {
    if (tab === 'history') void loadTimeline();
  }, [loadTimeline, tab]);

  const changeConsent = async (consentType, granted) => {
    const current = patient.consents?.find((consent) => consent.consent_type === consentType);
    if (
      consentType === 'ai_processing' &&
      granted &&
      !window.confirm(t('patient.confirmAiProcessingConsent'))
    )
      return;
    try {
      await api.post(`/patients/${patientId}/consent`, {
        consent_type: consentType,
        granted,
        version: current?.version || 1,
        language: i18n.language,
      });
      await loadPatient();
      notify(t('patient.consentSaved'), 'success');
    } catch {
      notify(t('patient.updateError'), 'error');
    }
  };

  const downloadAadhaarDocument = async (documentRecord) => {
    try {
      const { data } = await api.get(`/patients/${patientId}/aadhaar-documents/${documentRecord.id}`, { responseType: 'blob' });
      const objectUrl = URL.createObjectURL(data);
      const anchor = window.document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `aadhaar-redacted-${documentRecord.side}-${documentRecord.page}.png`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      notify(t('aadhaar.documentUnavailable'), 'error');
    }
  };

  const changeResearchConsent = async (granted) => {
    setResearchConsentSaving(true);
    try {
      if (granted) {
        const selectedLanguage = i18n.language.split('-')[0];
        await api.post('/research/consent', {
          research_ai_training: true,
          language: ['en', 'te', 'hi', 'or'].includes(selectedLanguage)
            ? selectedLanguage
            : 'en',
        });
        setResearchConsentAccepted(false);
        notify(t('patient.researchConsentGranted'), 'success');
      } else {
        if (!window.confirm(t('patient.researchConsentWithdrawConfirm'))) return;
        await api.post('/research/consent/withdraw', {});
        notify(t('patient.researchConsentWithdrawn'), 'success');
      }
      await loadResearchConsent();
    } catch {
      notify(
        granted
          ? t('patient.researchConsentGrantFailed')
          : t('patient.researchConsentWithdrawFailed'),
        'error',
      );
    } finally {
      setResearchConsentSaving(false);
    }
  };

  if (loading) return <Loading label={t('patient.loading')} />;
  if (!patient)
    return (
      <Card>
        <p>{t('patient.noData')}</p>
      </Card>
    );

  const tabNames = ['overview', 'history', 'screenings', 'referrals', 'appointments', 'medicines'];
  const arrayForTab = {
    screenings: patient.screenings,
    referrals: patient.referrals,
    appointments: patient.appointments,
    medicines: patient.medicines,
  }[tab];
  const formatDate = (value) => (value ? new Date(value).toLocaleString() : t('patient.none'));

  return (
    <div className="patient-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('patient.profile')}</p>
          <h1>{patient.full_name}</h1>
          <p className="page-heading__description">
            {patient.patient_code} · {patient.village_name || t('patient.none')} ·{' '}
            {patient.district}
          </p>
        </div>
      </div>
      <nav aria-label={t('patient.profile')} className="patient-tabs">
        {tabNames.map((name) => (
          <Button
            aria-current={tab === name ? 'page' : undefined}
            className={tab === name ? 'patient-tab--active' : ''}
            key={name}
            onClick={() => setTab(name)}
            type="button"
            variant="ghost"
          >
            {t(`patient.${name}`)}
          </Button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="patient-profile-grid">
          <Card>
            <h2>{t('patient.overview')}</h2>
            <dl className="patient-facts">
              <dt>{t('patient.age')}</dt>
              <dd>{patient.age ?? t('patient.none')}</dd>
              <dt>{t('aadhaar.dateOfBirth')}</dt>
              <dd>{patient.date_of_birth || t('patient.none')}</dd>
              <dt>{t('patient.gender')}</dt>
              <dd>{patient.gender || t('patient.none')}</dd>
              <dt>{t('patient.mobile')}</dt>
              <dd>{patient.mobile || t('patient.none')}</dd>
              <dt>{t('patient.village')}</dt>
              <dd>{patient.village_name || t('patient.none')}</dd>
              <dt>{t('patient.district')}</dt>
              <dd>{patient.district}</dd>
              <dt>{t('patient.mandal')}</dt>
              <dd>{patient.mandal}</dd>
              <dt>{t('patient.phc')}</dt>
              <dd>{patient.phc_name || t('patient.none')}</dd>
              <dt>{t('patient.address')}</dt>
              <dd>{patient.address || t('patient.none')}</dd>
            </dl>
          </Card>
          <Card>
            <h2>{t('patient.medicalHistory')}</h2>
            {patient.medical_history ? (
              <div className="patient-form-stack">
                <p>
                  <strong>{t('patient.conditions')}:</strong>{' '}
                  {patient.medical_history.conditions?.join(', ') || t('patient.none')}
                </p>
                <p>
                  <strong>{t('patient.allergies')}:</strong>{' '}
                  {patient.medical_history.allergies?.join(', ') || t('patient.none')}
                </p>
                <p>
                  <strong>{t('patient.medications')}:</strong>{' '}
                  {patient.medical_history.current_medications?.join(', ') || t('patient.none')}
                </p>
                <p>
                  {t('patient.tobacco')}:{' '}
                  {patient.medical_history.tobacco_use
                    ? t('patient.granted')
                    : t('patient.revoked')}
                  {' · '}
                  {t('patient.gutkha')}:{' '}
                  {patient.medical_history.gutkha_use ? t('patient.granted') : t('patient.revoked')}
                  {' · '}
                  {t('patient.areca')}:{' '}
                  {patient.medical_history.areca_nut_use
                    ? t('patient.granted')
                    : t('patient.revoked')}
                </p>
              </div>
            ) : (
              <p>{t('patient.noData')}</p>
            )}
          </Card>
          <Card className="patient-aadhaar-card">
            <h2>{t('aadhaar.title')}</h2>
            <dl className="patient-facts">
              <dt>{t('aadhaar.aadhaarNumber')}</dt><dd>{patient.aadhaar?.masked_number || t('patient.none')}</dd>
              <dt>{t('aadhaar.status')}</dt><dd>{t(`aadhaar.statuses.${patient.aadhaar?.verification_status || 'not_provided'}`)}</dd>
            </dl>
            {patient.aadhaar?.documents?.length > 0 && (
              <div className="patient-aadhaar-documents">
                <h3>{t('aadhaar.documents')}</h3>
                {patient.aadhaar.documents.map((documentRecord) => (
                  <Button key={documentRecord.id} onClick={() => void downloadAadhaarDocument(documentRecord)} type="button" variant="outline">
                    {t(`aadhaar.sides.${documentRecord.side}`)} · {documentRecord.page} — {t('aadhaar.downloadDocument')}
                  </Button>
                ))}
              </div>
            )}
          </Card>
          <Card className="patient-consent-card">
            <h2>{t('patient.consents')}</h2>
            {CONSENTS.map((consentType) => {
              const current = patient.consents?.find((item) => item.consent_type === consentType);
              const canChange = ['health_worker', 'doctor', 'patient'].includes(user.role);
              return (
                <div className="patient-consent-row" key={consentType}>
                  <div>
                    <strong>
                      {t(
                        `patient.${
                          consentType === 'data_collection'
                            ? 'dataCollection'
                            : consentType === 'aadhaar_documents'
                              ? 'aadhaarDocuments'
                            : consentType === 'ai_processing'
                              ? 'aiProcessing'
                              : consentType
                        }`,
                      )}
                    </strong>
                    <span>{current?.granted ? t('patient.granted') : t('patient.revoked')}</span>
                    {consentType === 'ai_processing' && (
                      <p className="patient-consent-disclosure">
                        {t('patient.aiProcessingDisclosure')}
                      </p>
                    )}
                  </div>
                  {canChange && (
                    <Button
                      onClick={() => void changeConsent(consentType, !current?.granted)}
                      type="button"
                      variant="outline"
                    >
                      {current?.granted ? t('patient.revoke') : t('patient.grant')}
                    </Button>
                  )}
                </div>
              );
            })}
            {user.role === 'patient' && (
              <div className="patient-consent-row patient-consent-row--research">
                <div>
                  <strong>{t('patient.researchAiTraining')}</strong>
                  {researchConsentLoading ? (
                    <span role="status">{t('patient.researchConsentLoading')}</span>
                  ) : researchConsent ? (
                    <>
                      <span>
                        {researchConsent.consent?.status === 'granted'
                          ? t('patient.granted')
                          : researchConsent.consent?.status === 'withdrawn'
                            ? t('patient.revoked')
                            : t('patient.researchConsentNotGranted')}
                      </span>
                      {researchConsent.consent?.consent_version && (
                        <span>
                          {t('patient.researchConsentVersion')}: {researchConsent.consent.consent_version}
                        </span>
                      )}
                      {formatConsentDate(
                        researchConsent.consent?.withdrawn_at ||
                          researchConsent.consent?.granted_at ||
                          researchConsent.consent?.created_at,
                        i18n.language,
                      ) && (
                        <span>
                          {researchConsent.consent?.status === 'withdrawn'
                            ? t('patient.researchConsentWithdrawnOn')
                            : t('patient.researchConsentRecordedOn')}
                          {': '}
                          {formatConsentDate(
                            researchConsent.consent.withdrawn_at ||
                              researchConsent.consent.granted_at ||
                              researchConsent.consent.created_at,
                            i18n.language,
                          )}
                        </span>
                      )}
                      {researchConsent.consent?.status === 'granted' &&
                        researchConsent.history?.find((entry) => entry.status === 'withdrawn') && (
                          <span>
                            {t('patient.researchConsentPreviouslyWithdrawn')}: {' '}
                            {formatConsentDate(
                              researchConsent.history.find((entry) => entry.status === 'withdrawn')
                                .withdrawn_at,
                              i18n.language,
                            )}
                          </span>
                        )}
                    </>
                  ) : (
                    <span>{t('patient.researchConsentLoadFailed')}</span>
                  )}
                  <p className="patient-consent-disclosure">
                    {t('patient.researchAiTrainingDisclosure')}
                  </p>
                  <Link to="/patient/research-consent">
                    {t('patient.researchConsentMoreInformation')}
                  </Link>
                  {researchConsent?.consent?.status !== 'granted' &&
                    researchConsent?.governance?.enabled && (
                      <label className="patient-consent-research-checkbox">
                        <input
                          checked={researchConsentAccepted}
                          disabled={researchConsentSaving || researchConsentLoading}
                          onChange={(event) => setResearchConsentAccepted(event.target.checked)}
                          type="checkbox"
                        />
                        <span>{t('patient.researchConsentExplicitAgreement')}</span>
                      </label>
                    )}
                  {researchConsent && !researchConsent.governance?.enabled && (
                    <span role="status">{t('patient.researchConsentUnavailable')}</span>
                  )}
                </div>
                {user.role === 'patient' && researchConsent?.consent?.status === 'granted' ? (
                  <Button
                    disabled={researchConsentSaving || researchConsentLoading}
                    onClick={() => void changeResearchConsent(false)}
                    type="button"
                    variant="outline"
                  >
                    {researchConsentSaving
                      ? t('loading')
                      : t('patient.researchConsentWithdrawAction')}
                  </Button>
                ) : researchConsent?.governance?.enabled ? (
                  <Button
                    disabled={
                      !researchConsentAccepted ||
                      researchConsentSaving ||
                      researchConsentLoading
                    }
                    onClick={() => void changeResearchConsent(true)}
                    type="button"
                    variant="outline"
                  >
                    {researchConsentSaving
                      ? t('loading')
                      : t('patient.researchConsentGrantAction')}
                  </Button>
                ) : null}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'history' && (
        <Card>
          <h2>{t('patient.timeline')}</h2>
          {timeline.items.length ? (
            <ol className="patient-timeline">
              {timeline.items.map((entry, index) => (
                <li key={`${entry.type}-${entry.occurred_at}-${index}`}>
                  <time>{formatDate(entry.occurred_at)}</time>
                  <strong>{entry.title}</strong>
                  <span>{t(`patient.${entry.type}`, entry.type.replaceAll('_', ' '))}</span>
                  {entry.type === 'ai_result' && (
                    <AiOutputBanner
                      isDemo={Boolean(entry.details?.is_demo)}
                      isFailed={entry.details?.inference_status === 'failed'}
                    />
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p>{t('patient.noData')}</p>
          )}
          {timeline.meta && (
            <Pagination
              onPageChange={setTimelinePage}
              page={timeline.meta.page}
              totalPages={timeline.meta.totalPages}
            />
          )}
        </Card>
      )}

      {arrayForTab && (
        <Card>
          <h2>{t(`patient.${tab}`)}</h2>
          {arrayForTab.length ? (
            <div className="patient-record-list">
              {arrayForTab.map((item) => (
                <article key={item.id}>
                  <strong>
                    {item.medicine_name ||
                      item.status ||
                      item.reason ||
                      item.facility_name ||
                      t('patient.noData')}
                  </strong>
                  <span>
                    {formatDate(
                      item.scheduled_at || item.screened_at || item.created_at || item.starts_at,
                    )}
                  </span>
                  {item.ai_results?.map((result, index) => (
                    <div key={`${result.risk_category}-${index}`}>
                      <AiOutputBanner
                        isDemo={Boolean(result.is_demo)}
                        isFailed={result.inference_status === 'failed'}
                      />
                    </div>
                  ))}
                </article>
              ))}
            </div>
          ) : (
            <p>{t('patient.noData')}</p>
          )}
        </Card>
      )}
    </div>
  );
}
