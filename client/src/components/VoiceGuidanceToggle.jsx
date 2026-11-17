import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useSpeechSynthesis from '../hooks/useSpeechSynthesis.js';

const STORAGE_KEY = 'aarogya-voice-guidance';

export default function VoiceGuidanceToggle({ speechController }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const internalSpeech = useSpeechSynthesis();
  const { speak, stop } = speechController || internalSpeech;
  const [enabled, setEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setTimeout(() => {
      const heading = document.querySelector(
        'main.page-content h1, main#main-content h1, main.auth-page h1, .language-card h1',
      );
      const description = heading?.parentElement?.querySelector('p:not(.eyebrow)')?.textContent;
      const message = [heading?.textContent, description].filter(Boolean).join('. ');
      if (message) speak(message, i18n.language);
    }, 250);
    const announceFocusedControl = (event) => {
      const control = event.target.closest?.('button, a, input, select, textarea, [role="button"]');
      if (!control || control.classList.contains('voice-guidance-toggle')) return;
      const message = control.getAttribute('aria-label')
        || control.labels?.[0]?.textContent?.trim()
        || control.textContent?.trim();
      if (message) speak(message, i18n.language);
    };
    document.addEventListener('focusin', announceFocusedControl);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', announceFocusedControl);
    };
  }, [enabled, i18n.language, location.pathname, speak]);

  const toggle = () => {
    const next = !enabled;
    localStorage.setItem(STORAGE_KEY, String(next));
    setEnabled(next);
    if (!next) stop();
  };

  return (
    <button
      aria-pressed={enabled}
      className="voice-guidance-toggle"
      onClick={toggle}
      type="button"
    >
      {enabled ? <VolumeX aria-hidden="true" size={18} /> : <Volume2 aria-hidden="true" size={18} />}
      {enabled ? t('phase10.voiceGuidanceOff') : t('phase10.voiceGuidanceOn')}
    </button>
  );
}
