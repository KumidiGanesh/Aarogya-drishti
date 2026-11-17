import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Loading from '../components/ui/Loading.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';

const disclosures = [
  ['purposeTitle', 'purpose'],
  ['dataTitle', 'data'],
  ['useTitle', 'use'],
  ['privacyTitle', 'privacy'],
  ['risksTitle', 'risks'],
  ['voluntaryTitle', 'voluntary'],
  ['withdrawalTitle', 'withdrawal'],
];

function formatDate(value, locale) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function ResearchConsentPage() {
  const { t, i18n } = useTranslation();
  const { notify } = useToast();
  const [data, setData] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadConsent = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await api.get('/research/consent');
      setData(response.data.data);
    } catch {
      setLoadError(true);
      notify(t('researchConsent.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  useEffect(() => {
    void loadConsent();
  }, [loadConsent]);

  const submitConsent = async (event) => {
    event.preventDefault();
    if (!accepted) {
      notify(t('researchConsent.required'), 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post('/research/consent', {
        research_ai_training: true,
        language: ['en', 'te', 'hi', 'or'].includes(i18n.language) ? i18n.language : 'en',
      });
      setAccepted(false);
      notify(t('researchConsent.grantedNotice'), 'success');
      await loadConsent();
    } catch {
      notify(t('researchConsent.grantFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const withdrawConsent = async () => {
    if (!window.confirm(t('researchConsent.withdrawConfirm'))) return;
    setSaving(true);
    try {
      await api.post('/research/consent/withdraw', {});
      notify(t('researchConsent.withdrawnNotice'), 'success');
      await loadConsent();
    } catch {
      notify(t('researchConsent.withdrawFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label={t('researchConsent.loading')} />;
  if (loadError || !data) {
    return (
      <Card className="research-consent">
        <p role="alert">{t('researchConsent.loadFailed')}</p>
        <Button type="button" onClick={() => void loadConsent()}>{t('screening.retry')}</Button>
      </Card>
    );
  }

  const { governance, consent, history } = data;
  const active = consent?.status === 'granted';
  const locale = i18n.language;

  return (
    <div className="research-consent">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t('researchConsent.navTitle')}</p>
          <h1>{t('researchConsent.title')}</h1>
          <p className="page-heading__description">{t('researchConsent.description')}</p>
        </div>
      </header>

      <Card className="research-consent__status" aria-live="polite">
        <h2>{t('researchConsent.status')}</h2>
        <p>
          {active
            ? t('researchConsent.activeStatus')
            : consent?.status === 'withdrawn'
              ? t('researchConsent.withdrawn')
              : t('researchConsent.notGiven')}
        </p>
        {consent?.consent_version && (
          <p>{t('researchConsent.version')}: {consent.consent_version}</p>
        )}
        {active && (
          <Button type="button" variant="secondary" disabled={saving} onClick={withdrawConsent}>
            {saving ? t('loading') : t('researchConsent.withdraw')}
          </Button>
        )}
      </Card>

      <Card className="research-consent__disclosure">
        {disclosures.map(([title, description]) => (
          <section key={title}>
            <h2>{t(`researchConsent.${title}`)}</h2>
            <p>{t(`researchConsent.${description}`)}</p>
          </section>
        ))}
        <section>
          <h2>{t('researchConsent.governanceTitle')}</h2>
          <p>
            {governance.enabled
              ? t('researchConsent.governanceReady')
              : t('researchConsent.governanceUnavailable')}
          </p>
          {governance.enabled && (
            <dl className="research-consent__governance">
              <dt>{t('researchConsent.approvalReference')}</dt>
              <dd>{governance.approval_reference}</dd>
              <dt>{t('researchConsent.governanceBody')}</dt>
              <dd>{governance.governance_body}</dd>
              <dt>{t('researchConsent.contact')}</dt>
              <dd>{governance.contact}</dd>
              <dt>{t('researchConsent.retentionPolicy')}</dt>
              <dd>{governance.retention_policy}</dd>
            </dl>
          )}
        </section>
      </Card>

      {!active && (
        <Card className="research-consent__action">
          {!governance.enabled ? (
            <p role="status">{t('researchConsent.unavailableNote')}</p>
          ) : (
            <form onSubmit={submitConsent}>
              <label className="research-consent__checkbox">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={saving}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span>{t('researchConsent.consentLabel')}</span>
              </label>
              <Button type="submit" disabled={!accepted || saving}>
                {saving ? t('loading') : t('researchConsent.grant')}
              </Button>
            </form>
          )}
        </Card>
      )}

      <Card className="research-consent__history">
        <h2>{t('researchConsent.historyTitle')}</h2>
        {!history.length ? (
          <p>{t('researchConsent.noHistory')}</p>
        ) : (
          <ul>
            {history.map((entry) => {
              const date = entry.withdrawn_at || entry.granted_at;
              return (
                <li key={entry.id}>
                  <strong>
                    {entry.status === 'granted'
                      ? t('researchConsent.grantEvent')
                      : t('researchConsent.withdrawEvent')}
                  </strong>
                  {' · '}{t('researchConsent.version')}: {entry.consent_version}
                  {formatDate(date, locale) && (
                    <time dateTime={date}>{' · '}{formatDate(date, locale)}</time>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
