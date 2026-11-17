import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Select from '../components/ui/Select.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';

export default function AdminSettingsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const changeLanguage = async (event) => {
    const language = event.target.value;
    await i18n.changeLanguage(language);
    try {
      await api.put('/languages/preference', { language_code: language });
      notify(t('phase10.languageSaved'), 'success');
    } catch {
      notify(t('phase10.languageSaveFailed'), 'error');
    }
  };
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('admin.administration')}</p>
          <h1>{t('admin.systemSettings')}</h1>
        </div>
      </div>
      <Card className="admin-settings-card">
        <h2>{t('language')}</h2>
        <Select id="settings-language" label={t('language')} onChange={changeLanguage} value={i18n.language}>
          <option value="en">{t('languages.en')}</option>
          <option value="te">{t('languages.te')}</option>
          <option value="hi">{t('languages.hi')}</option>
          <option value="or">{t('languages.or')}</option>
        </Select>
        <p>{user.full_name}</p>
        <p><Link to="/language-assistant">{t('phase10.assistantTitle')}</Link></p>
        <p><Link to="/voice-support">{t('phase10.voiceTitle')}</Link></p>
      </Card>
    </div>
  );
}
