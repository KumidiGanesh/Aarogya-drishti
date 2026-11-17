import { useState } from 'react';
import { Copy, Languages, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Select from '../components/ui/Select.jsx';
import api from '../services/api.js';
import useSpeechSynthesis from '../hooks/useSpeechSynthesis.js';

const LANGUAGE_OPTIONS = [
  { code: 'en', native: 'English' },
  { code: 'te', native: 'తెలుగు' },
  { code: 'hi', native: 'हिन्दी' },
  { code: 'or', native: 'ଓଡ଼ିଆ' },
];

export default function LanguageAssistantPage() {
  const { t, i18n } = useTranslation();
  const defaultTarget = i18n.language === 'en' ? 'te' : 'en';
  const [sourceLanguage, setSourceLanguage] = useState('en');
  const [targetLanguage, setTargetLanguage] = useState(defaultTarget);
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const speech = useSpeechSynthesis();

  const runTranslation = async (mode = 'translate', phrase = text) => {
    if (!phrase.trim()) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const { data } = await api.post('/language/translate', {
        text: phrase,
        source_lang: sourceLanguage,
        target_lang: targetLanguage,
        mode,
      });
      const translation = data.data;
      setResult(translation);
      setHistory((items) => [
        { source: phrase, target: translation.translated_text, sourceLanguage, targetLanguage },
        ...items,
      ].slice(0, 10));
    } catch {
      setError(t('phase10.translationError'));
    } finally {
      setBusy(false);
    }
  };

  const sendChatMessage = async (event) => {
    event.preventDefault();
    const message = chatText.trim();
    if (!message || chatBusy) return;
    setChatBusy(true);
    setChatError('');
    try {
      const language = ['en', 'te', 'hi', 'or'].includes(i18n.language)
        ? i18n.language
        : i18n.language.split('-')[0];
      const { data } = await api.post('/language/translate', {
        text: message,
        source_lang: language,
        target_lang: language,
        mode: 'chat',
        history: chatMessages.slice(-6).map(({ role, text: itemText }) => ({
          role,
          text: itemText,
        })),
      });
      setChatMessages((items) => [
        ...items,
        { role: 'user', text: message },
        { role: 'assistant', text: data.data.translated_text },
      ]);
      setChatText('');
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setChatError(code === 'CHATBOT_INPUT_PRIVATE'
        ? t('phase10.chatbotPrivateError')
        : code === 'CHATBOT_UNAVAILABLE'
          ? t('phase10.chatbotUnavailable')
          : t('phase10.chatbotError'));
    } finally {
      setChatBusy(false);
    }
  };

  const copyResult = async () => {
    if (!result?.translated_text) return;
    try {
      await navigator.clipboard.writeText(result.translated_text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t('phase10.translationError'));
    }
  };

  return (
    <div className="phase10-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><Languages aria-hidden="true" size={16} /> {t('phase10.assistantTitle')}</p>
          <h1>{t('phase10.assistantTitle')}</h1>
          <p>{t('phase10.assistantDescription')}</p>
        </div>
      </div>
      <p className="phase10-disclaimer" role="note">{t('phase10.translationDisclaimer')}</p>
      <Card className="assistant-card chatbot-card">
        <h2>{t('phase10.chatbotTitle')}</h2>
        <p>{t('phase10.chatbotDescription')}</p>
        <p className="phase10-disclaimer" role="note">{t('patient.aiDisclaimer')}</p>
        <p className="phase10-disclaimer" role="note">{t('phase10.chatbotPrivacyNotice')}</p>
        <p className="phase10-disclaimer" role="note">{t('phase10.chatbotDisclaimer')}</p>
        <div aria-live="polite" className="chatbot-messages">
          {chatMessages.map((message, index) => (
            <p className={`chatbot-message chatbot-message--${message.role}`} key={`${index}-${message.role}`}>
              <strong>{t(message.role === 'user' ? 'phase10.chatbotYou' : 'phase10.chatbotAssistant')}</strong>
              <span lang={i18n.language}>{message.text}</span>
            </p>
          ))}
        </div>
        <form className="chatbot-form" onSubmit={sendChatMessage}>
          <label className="field-label" htmlFor="chatbot-question">{t('phase10.chatbotPrompt')}</label>
          <textarea
            id="chatbot-question"
            maxLength={2000}
            onChange={(event) => setChatText(event.target.value)}
            rows={3}
            value={chatText}
          />
          {chatError && <p className="form-error" role="alert">{chatError}</p>}
          <Button disabled={chatBusy || !chatText.trim()} type="submit">
            {chatBusy ? t('loading') : t('phase10.chatbotSend')}
          </Button>
        </form>
      </Card>
      <Card className="assistant-card">
        <div className="assistant-languages">
          <Select
            id="translation-source-language"
            label={t('phase10.sourceLanguage')}
            onChange={(event) => setSourceLanguage(event.target.value)}
            value={sourceLanguage}
          >
            {LANGUAGE_OPTIONS.filter(({ code }) => code !== targetLanguage).map(({ code, native }) => (
              <option key={code} value={code}>{native}</option>
            ))}
          </Select>
          <Select
            id="translation-target-language"
            label={t('phase10.targetLanguage')}
            onChange={(event) => setTargetLanguage(event.target.value)}
            value={targetLanguage}
          >
            {LANGUAGE_OPTIONS.filter(({ code }) => code !== sourceLanguage).map(({ code, native }) => (
              <option key={code} value={code}>{native}</option>
            ))}
          </Select>
        </div>
        <label className="field-label" htmlFor="assistant-text">{t('phase10.sourceText')}</label>
        <textarea
          id="assistant-text"
          maxLength={2000}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          value={text}
        />
        <div className="assistant-actions">
          <Button disabled={busy || !text.trim()} onClick={() => runTranslation()}>
            {busy ? t('loading') : t('phase10.translate')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              const phrase = 'Explain basic oral health: brushing, tobacco risks, or mouth ulcers lasting more than two weeks.';
              setText(phrase);
              runTranslation('explain_oral_health', phrase);
            }}
            variant="outline"
          >
            {t('phase10.explain')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              const phrase = 'Basic oral hygiene instructions';
              setText(phrase);
              runTranslation('patient_instruction', phrase);
            }}
            variant="outline"
          >
            {t('phase10.instructions')}
          </Button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </Card>
      {result && (
        <Card aria-live="polite" className="assistant-result">
          <div className="assistant-result__heading">
            <h2>{t('phase10.translationResult')}</h2>
            <div className="assistant-actions">
              <Button onClick={copyResult} variant="outline">
                <Copy aria-hidden="true" size={17} /> {copied ? t('phase10.copied') : t('phase10.copy')}
              </Button>
              <Button
                onClick={() => speech.speaking
                  ? speech.stop()
                  : speech.speak(result.translated_text, targetLanguage)}
                variant="outline"
              >
                {speech.speaking
                  ? <VolumeX aria-hidden="true" size={17} />
                  : <Volume2 aria-hidden="true" size={17} />}
                {speech.speaking ? t('phase10.stopListening') : t('phase10.listen')}
              </Button>
            </div>
          </div>
          <p lang={targetLanguage}>{result.translated_text}</p>
          <p className="phase10-disclaimer">{t('phase10.translationDisclaimer')}</p>
        </Card>
      )}
      {history.length > 0 && (
        <section aria-labelledby="translation-history-title" className="translation-history">
          <h2 id="translation-history-title">{t('phase10.historyTitle')}</h2>
          {history.map((item, index) => (
            <Card className="translation-history__item" key={`${index}-${item.source}`}>
              <p>{item.source}</p>
              <p lang={item.targetLanguage}>{item.target}</p>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
