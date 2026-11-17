import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Eraser,
  LoaderCircle,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import useSpeechRecognition from '../../hooks/useSpeechRecognition.js';
import useSpeechSynthesis from '../../hooks/useSpeechSynthesis.js';
import {
  askCopilot,
  getCopilotHealth,
} from './copilotService.js';
import { COPILOT_LANGUAGES, COPILOT_TEXT } from './copilotText.js';
import { getOfflineAnswer } from './offlineHealthKnowledge.js';
import './VoiceCopilot.css';

const LANGUAGE_LOCALES = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN', or: 'or-IN' };
const SPEECH_ERRORS = {
  'permission-denied': 'permissionDenied',
  'microphone-unavailable': 'microphoneUnavailable',
  'no-speech': 'noSpeech',
  'network-error': 'networkError',
  'recognition-failed': 'recognitionFailed',
  unavailable: 'speechUnsupported',
};

function initialLanguage() {
  const savedLanguage = window.localStorage.getItem('aarogya-language')?.split('-')[0];
  return COPILOT_LANGUAGES.some(({ code }) => code === savedLanguage) ? savedLanguage : 'en';
}

function timeLabel(timestamp, language) {
  return new Intl.DateTimeFormat(LANGUAGE_LOCALES[language], {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function offlineKnowledge(question, language) {
  return getOfflineAnswer(question, language);
}

export default function VoiceCopilot() {
  const [language, setLanguage] = useState(initialLanguage);
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [serviceStatus, setServiceStatus] = useState('checking');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [lastAnswer, setLastAnswer] = useState('');
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [privacyError, setPrivacyError] = useState(false);
  const sendingRef = useRef(false);
  const messagesEndRef = useRef(null);
  const speechRecognition = useSpeechRecognition(language);
  const speechSynthesis = useSpeechSynthesis();
  const text = COPILOT_TEXT[language];
  const assistantLocale = LANGUAGE_LOCALES[language];

  const checkService = useCallback(async () => {
    if (!navigator.onLine) {
      setServiceStatus('offline');
      return;
    }
    setServiceStatus('checking');
    try {
      const health = await getCopilotHealth();
      setServiceStatus(health.configured ? 'configured' : 'unconfigured');
    } catch {
      setServiceStatus('unreachable');
    }
  }, []);

  useEffect(() => {
    const updateNetwork = () => {
      const online = navigator.onLine;
      setNetworkOnline(online);
      if (online) void checkService();
      else setServiceStatus('offline');
    };
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    void checkService();
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, [checkService]);

  useEffect(() => {
    if (speechRecognition.transcript) setDraft(speechRecognition.transcript);
  }, [speechRecognition.transcript]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  const startListening = () => {
    setDraft('');
    setPrivacyError(false);
    speechRecognition.start();
  };

  const stopListening = () => {
    speechRecognition.stop();
  };

  const askQuestion = async (event) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || sendingRef.current) return;

    sendingRef.current = true;
    speechRecognition.stop();
    speechSynthesis.stop();
    setBusy(true);
    setPrivacyError(false);
    const previousMessages = messages;
    setMessages((current) => [
      ...current,
      { role: 'user', text: question, timestamp: Date.now(), language },
    ]);
    setDraft('');

    let answer;
    let source = 'offline';
    const canTryOnline = navigator.onLine
      && !['unconfigured', 'unreachable', 'unavailable'].includes(serviceStatus);
    if (canTryOnline) {
      try {
        const result = await askCopilot({
          text: question,
          language,
          history: previousMessages
            .filter((message) => message.role === 'user' || message.role === 'assistant')
            .slice(-8)
            .map(({ role, text: messageText }) => ({ role, text: messageText })),
        });
        answer = result.answer;
        source = 'online';
        setServiceStatus('connected');
      } catch (error) {
        if (error.response?.data?.code === 'CHATBOT_INPUT_PRIVATE') {
          answer = text.privateQuestion;
          source = 'privacy';
          setPrivacyError(true);
        } else {
          answer = offlineKnowledge(question, language);
          setServiceStatus('unavailable');
        }
      }
    } else {
      answer = offlineKnowledge(question, language);
    }

    if (!answer?.trim()) answer = text.noAnswer;
    setMessages((current) => [
      ...current,
      { role: 'assistant', text: answer, timestamp: Date.now(), language, source },
    ]);
    setLastAnswer(answer);
    if (!muted) speechSynthesis.speak(answer, language);
    setBusy(false);
    sendingRef.current = false;
  };

  const clearConversation = () => {
    speechRecognition.stop();
    speechSynthesis.stop();
    setMessages([]);
    setDraft('');
    setLastAnswer('');
    setPrivacyError(false);
  };

  const toggleMute = () => {
    if (!muted) speechSynthesis.stop();
    setMuted((current) => !current);
  };

  const repeatAnswer = () => {
    if (lastAnswer && !muted) speechSynthesis.speak(lastAnswer, language);
  };

  const serviceLabel = {
    checking: text.aiChecking,
    configured: text.aiConfigured,
    connected: text.aiConnected,
    unconfigured: text.aiNotConfigured,
    unavailable: text.aiUnavailable,
    unreachable: text.aiUnavailable,
    offline: text.offlineFaq,
  }[serviceStatus];
  const recognitionError = speechRecognition.error
    ? text[SPEECH_ERRORS[speechRecognition.error]] || text.recognitionFailed
    : '';
  const voiceError = speechSynthesis.error === 'unavailable' ? text.voiceUnavailable : '';

  return (
    <section aria-labelledby="voice-copilot-title" className="voice-copilot" id="voice-copilot">
      <header className="voice-copilot__header">
        <div className="voice-copilot__identity">
          <div aria-hidden="true" className={`voice-copilot__avatar${speechSynthesis.speaking ? ' is-speaking' : ''}`}>
            <Bot size={34} />
            <span className="voice-copilot__avatar-sparkle"><Sparkles size={15} /></span>
          </div>
          <div>
            <p className="voice-copilot__eyebrow">{text.title}</p>
            <h2 id="voice-copilot-title">{text.title}</h2>
            <p>{text.description}</p>
          </div>
        </div>
        <div className="voice-copilot__status-group">
          <span className={`voice-copilot__network${networkOnline ? ' is-online' : ' is-offline'}`} role="status">
            {networkOnline ? <Wifi aria-hidden="true" size={17} /> : <WifiOff aria-hidden="true" size={17} />}
            {networkOnline ? text.online : text.offline}
          </span>
          <span className="voice-copilot__service-status">{serviceLabel}</span>
        </div>
      </header>

      <div className="voice-copilot__toolbar">
        <label className="voice-copilot__language">
          <span>{text.language}</span>
          <select
            onChange={(event) => {
              speechRecognition.stop();
              setLanguage(event.target.value);
            }}
            value={language}
          >
            {COPILOT_LANGUAGES.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <div aria-label={text.title} className="voice-copilot__controls">
          <button
            aria-pressed={speechRecognition.listening}
            className="voice-copilot__control voice-copilot__control--primary"
            disabled={!speechRecognition.supported || speechRecognition.loading || busy}
            onClick={startListening}
            type="button"
          >
            {speechRecognition.loading
              ? <LoaderCircle aria-hidden="true" className="voice-copilot__spinner" size={19} />
              : <Mic aria-hidden="true" size={20} />}
            {speechRecognition.loading ? text.starting : text.startListening}
          </button>
          <button
            className="voice-copilot__control"
            disabled={!speechRecognition.listening}
            onClick={stopListening}
            type="button"
          >
            <MicOff aria-hidden="true" size={19} />
            {text.stopListening}
          </button>
          <button
            aria-label={muted ? text.unmute : text.mute}
            aria-pressed={muted}
            className="voice-copilot__icon-button"
            onClick={toggleMute}
            type="button"
          >
            {muted ? <VolumeX aria-hidden="true" size={20} /> : <Volume2 aria-hidden="true" size={20} />}
          </button>
          <button
            className="voice-copilot__control"
            disabled={!lastAnswer || muted}
            onClick={repeatAnswer}
            type="button"
          >
            <Volume2 aria-hidden="true" size={19} />
            {text.repeatAnswer}
          </button>
          <button className="voice-copilot__control" disabled={!messages.length} onClick={clearConversation} type="button">
            <Eraser aria-hidden="true" size={19} />
            {text.clearChat}
          </button>
        </div>
      </div>

      <div aria-live="polite" className="voice-copilot__activity" role="status">
        {speechRecognition.loading && text.starting}
        {speechRecognition.listening && (
          <span className="voice-copilot__activity-label"><span className="voice-copilot__pulse" />{text.listening}</span>
        )}
        {speechSynthesis.speaking && (
          <span className="voice-copilot__activity-label"><span className="voice-copilot__pulse voice-copilot__pulse--speaking" />{text.speaking}</span>
        )}
      </div>

      <div className="voice-copilot__layout">
        <div className="voice-copilot__voice-card">
          <div aria-hidden="true" className={`voice-copilot__orb${speechRecognition.listening ? ' is-listening' : ''}`}>
            <Mic size={42} />
          </div>
          <p>{speechRecognition.listening ? text.listening : text.description}</p>
          <p className="voice-copilot__speech-help">{text.speechHelp}</p>
          {!speechRecognition.supported && (
            <p className="voice-copilot__error" role="status">{text.speechUnsupported}</p>
          )}
          {recognitionError && <p className="voice-copilot__error" role="alert">{recognitionError}</p>}
          {voiceError && <p className="voice-copilot__error" role="status">{voiceError}</p>}
        </div>

        <div className="voice-copilot__conversation">
          <div aria-live="polite" aria-relevant="additions text" className="voice-copilot__messages" role="log">
            {!messages.length && (
              <p className="voice-copilot__empty">{text.description}</p>
            )}
            {messages.map((message, index) => (
              <article className={`voice-copilot__message voice-copilot__message--${message.role}`} key={`${message.timestamp}-${index}`}>
                <div className="voice-copilot__message-meta">
                  <strong>{message.role === 'user' ? text.patient : text.assistant}</strong>
                  <span>{message.language.toUpperCase()} · {timeLabel(message.timestamp, message.language)}</span>
                </div>
                <p>{message.text}</p>
                {message.role === 'assistant' && message.source !== 'privacy' && (
                  <span className="voice-copilot__source">
                    {message.source === 'online' ? text.aiConnected : text.offlineFaq}
                  </span>
                )}
              </article>
            ))}
            {speechRecognition.transcript && (
              <article className="voice-copilot__message voice-copilot__message--user voice-copilot__message--draft">
                <div className="voice-copilot__message-meta"><strong>{text.patient}</strong><span>{language.toUpperCase()} · {text.listening}</span></div>
                <p>{speechRecognition.transcript}</p>
              </article>
            )}
            {busy && (
              <p className="voice-copilot__thinking" role="status">
                <LoaderCircle aria-hidden="true" className="voice-copilot__spinner" size={18} />
                {text.waiting}
              </p>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="voice-copilot__composer" onSubmit={askQuestion}>
            <label htmlFor="voice-copilot-question">{text.questionLabel}</label>
            <textarea
              id="voice-copilot-question"
              lang={assistantLocale}
              maxLength={2000}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={text.placeholder}
              rows={3}
              value={draft}
            />
            <div className="voice-copilot__composer-actions">
              <span>{privacyError ? text.privateQuestion : text.disclaimer}</span>
              <button className="voice-copilot__send" disabled={busy || !draft.trim()} type="submit">
                {busy
                  ? <LoaderCircle aria-hidden="true" className="voice-copilot__spinner" size={19} />
                  : <Send aria-hidden="true" size={19} />}
                {text.send}
              </button>
            </div>
          </form>
        </div>
      </div>
      <p className="voice-copilot__disclaimer">{text.disclaimer}</p>
    </section>
  );
}
