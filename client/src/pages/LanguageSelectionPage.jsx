import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';
import VoiceGuidanceToggle from '../components/VoiceGuidanceToggle.jsx';

const LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'te', native: 'తెలుగు' },
  { code: 'hi', native: 'हिन्दी' },
  { code: 'or', native: 'ଓଡ଼ିଆ' },
];

export default function LanguageSelectionPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [saving, setSaving] = useState(false);

  const selectLanguage = async (language) => {
    await i18n.changeLanguage(language);
    setSaving(true);
    try {
      if (user) await api.put('/languages/preference', { language_code: language });
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch {
      notify(t('phase10.languageSaveFailed'), 'error');
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="language-page">
      <section aria-labelledby="language-title" className="language-card">
        <p className="eyebrow">{t('brandName')}</p>
        <h1 id="language-title">{t('phase10.languageTitle')}</h1>
        <p>{t('phase10.languageDescription')}</p>
        <VoiceGuidanceToggle />
        <div className="language-options">
          {LANGUAGES.map(({ code, native }) => (
            <Button
              aria-pressed={i18n.language === code}
              className="language-option"
              disabled={saving}
              key={code}
              onClick={() => selectLanguage(code)}
              type="button"
              variant={i18n.language === code ? 'primary' : 'outline'}
            >
              <span lang={code}>{native}</span>
              <span className="language-option__action">{t('phase10.languageSelect')}</span>
            </Button>
          ))}
        </div>
      </section>
    </main>
  );
}
