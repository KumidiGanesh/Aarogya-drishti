import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import api from '../services/api.js';

const privacyKeys = ['data_collection', 'photo', 'location', 'teleconsultation', 'data_sharing'];
const defaults = {
  account: { full_name: '', mobile: '', email: '' },
  language: 'en',
  notification_preferences: { types: {}, channels: { in_app: true, sms: false, push: false }, quiet_hours: { enabled: false, start: '22:00', end: '07:00' } },
  privacy: {},
  font_size: 'medium',
  voice: { enabled: true, language: 'en-IN', speed: 1 },
};

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [settings, setSettings] = useState(defaults);
  const [systemSettings, setSystemSettings] = useState('{}');
  const [message, setMessage] = useState('');
  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      const result = { ...defaults, ...data.data };
      setSettings(result);
      setSystemSettings(JSON.stringify(result.system_settings || {}, null, 2));
      document.documentElement.style.setProperty('--app-font-size', `${{ small: 14, medium: 16, large: 18, 'extra-large': 20 }[result.font_size] || 16}px`);
    }).catch(() => setMessage(t('phase11.settingsError')));
  }, [t]);

  const change = (section, field, value) => {
    setSettings((current) => ({ ...current, [section]: { ...current[section], [field]: value } }));
  };
  const changeLanguage = async (event) => {
    const language = event.target.value;
    setSettings((current) => ({ ...current, language }));
    await i18n.changeLanguage(language);
  };
  const save = async (event) => {
    event.preventDefault();
    try {
      const payload = { ...settings };
      if (user.role === 'super_admin') payload.system_settings = JSON.parse(systemSettings);
      delete payload.system_settings;
      if (user.role === 'super_admin') payload.system_settings = JSON.parse(systemSettings);
      const { data } = await api.put('/settings', payload);
      setSettings({ ...defaults, ...data.data });
      await i18n.changeLanguage(data.data.language);
      document.documentElement.style.setProperty('--app-font-size', `${{ small: 14, medium: 16, large: 18, 'extra-large': 20 }[data.data.font_size] || 16}px`);
      setMessage(t('phase11.settingsSaved'));
    } catch {
      setMessage(t('phase11.settingsError'));
    }
  };
  const logoutNow = async () => {
    await logout();
    window.location.assign('/login');
  };
  const types = ['appointment', 'medicine', 'referral', 'consultation', 'followup', 'emergency', 'registration'];
  return (
    <div className="admin-page">
      <div className="page-heading"><h1>{t('phase11.settingsTitle')}</h1></div>
      <form className="settings-form" onSubmit={save}>
        <Card>
          <h2>{t('phase11.accountSettings')}</h2>
          <label>{t('phase11.fullName')}<input onChange={(event) => change('account', 'full_name', event.target.value)} value={settings.account.full_name || ''} /></label>
          <label>{t('phase11.mobile')}<input onChange={(event) => change('account', 'mobile', event.target.value)} value={settings.account.mobile || ''} /></label>
          <label>{t('phase11.email')}<input onChange={(event) => change('account', 'email', event.target.value)} value={settings.account.email || ''} /></label>
          <label>{t('language')}<select onChange={changeLanguage} value={settings.language}>
            <option value="en">{t('languages.en')}</option><option value="te">{t('languages.te')}</option><option value="hi">{t('languages.hi')}</option><option value="or">{t('languages.or')}</option>
          </select></label>
        </Card>
        <Card>
          <h2>{t('phase11.privacySettings')}</h2>
          {privacyKeys.map((key) => (
            <label className="setting-toggle" key={key}>
              <input checked={Boolean(settings.privacy?.[key])} onChange={(event) => change('privacy', key, event.target.checked)} type="checkbox" />
              {t(`phase11.${({
                data_collection: 'dataCollection',
                photo: 'photoConsent',
                location: 'locationConsent',
                teleconsultation: 'teleconsultationConsent',
                data_sharing: 'dataSharing',
              })[key]}`)}
            </label>
          ))}
        </Card>
        <Card>
          <h2>{t('phase11.notificationPreferences')}</h2>
          <div className="settings-checks">{[['in_app', 'inApp'], ['sms', 'sms'], ['push', 'push']].map(([key, label]) => (
            <label className="setting-toggle" key={key}>
              <input checked={settings.notification_preferences?.channels?.[key] ?? (key === 'in_app')} onChange={(event) => change('notification_preferences', 'channels', { ...settings.notification_preferences.channels, [key]: event.target.checked })} type="checkbox" />
              {t(`phase11.${label}`)}
            </label>
          ))}</div>
          <h3>{t('phase11.quietHours')}</h3>
          <label className="setting-toggle"><input checked={Boolean(settings.notification_preferences?.quiet_hours?.enabled)} onChange={(event) => change('notification_preferences', 'quiet_hours', { ...settings.notification_preferences.quiet_hours, enabled: event.target.checked })} type="checkbox" />{t('phase11.quietHoursEnabled')}</label>
          <div className="filter-row">
            <label>{t('phase11.quietHoursStart')}<input onChange={(event) => change('notification_preferences', 'quiet_hours', { ...settings.notification_preferences.quiet_hours, start: event.target.value })} type="time" value={settings.notification_preferences?.quiet_hours?.start || '22:00'} /></label>
            <label>{t('phase11.quietHoursEnd')}<input onChange={(event) => change('notification_preferences', 'quiet_hours', { ...settings.notification_preferences.quiet_hours, end: event.target.value })} type="time" value={settings.notification_preferences?.quiet_hours?.end || '07:00'} /></label>
          </div>
          <div className="settings-checks">{types.map((type) => (
            <label className="setting-toggle" key={type}>
              <input checked={type === 'emergency' || settings.notification_preferences?.types?.[type] !== false} disabled={type === 'emergency'} onChange={(event) => change('notification_preferences', 'types', { ...settings.notification_preferences.types, [type]: event.target.checked })} type="checkbox" />
              {t(`phase11.types.${type}`)}
            </label>
          ))}</div>
        </Card>
        <Card>
          <h2>{t('phase11.fontSize')}</h2>
          <select onChange={(event) => {
            const fontSize = event.target.value;
            setSettings({ ...settings, font_size: fontSize });
            document.documentElement.style.setProperty('--app-font-size', `${{ small: 14, medium: 16, large: 18, 'extra-large': 20 }[fontSize]}px`);
          }} value={settings.font_size}>
            <option value="small">{t('phase11.small')}</option><option value="medium">{t('phase11.medium')}</option><option value="large">{t('phase11.large')}</option><option value="extra-large">{t('phase11.extraLarge')}</option>
          </select>
          <h2>{t('phase11.voiceSettings')}</h2>
          <label className="setting-toggle"><input checked={Boolean(settings.voice?.enabled)} onChange={(event) => change('voice', 'enabled', event.target.checked)} type="checkbox" />{t('phase11.voiceEnabled')}</label>
          <label>{t('phase11.voiceLanguage')}<select onChange={(event) => change('voice', 'language', event.target.value)} value={settings.voice?.language || 'en-IN'}>
            <option value="en-IN">English</option><option value="te-IN">తెలుగు</option><option value="hi-IN">हिन्दी</option><option value="or-IN">ଓଡ଼ିଆ</option>
          </select></label>
          <label>{t('phase11.voiceSpeed')}<input max="2" min="0.5" onChange={(event) => change('voice', 'speed', Number(event.target.value))} step="0.1" type="range" value={settings.voice?.speed || 1} /></label>
        </Card>
        {user.role === 'super_admin' && (
          <Card><h2>{t('admin.systemSettings')}</h2><textarea aria-label={t('admin.systemSettings')} onChange={(event) => setSystemSettings(event.target.value)} rows="6" value={systemSettings} /></Card>
        )}
        {message && <p role="status">{message}</p>}
        <div className="filter-row">
          <button className="button" type="submit">{t('phase11.saveSettings')}</button>
          <Link className="button button--secondary" to="/change-password">{t('phase11.passwordChange')}</Link>
          <button className="button button--secondary" onClick={logoutNow} type="button">{t('phase11.signOut')}</button>
        </div>
      </form>
    </div>
  );
}
