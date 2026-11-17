import { useEffect, useRef, useState } from 'react';
import { Eraser, Mic, MicOff, Send, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import useSpeechSynthesis from '../hooks/useSpeechSynthesis.js';
import VoiceGuidanceToggle from '../components/VoiceGuidanceToggle.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import api from '../services/api.js';
import { useToast } from '../components/ui/Toast.jsx';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'or', name: 'ଓଡ଼ିଆ' },
];

export default function VoiceSupportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const speech = useSpeechSynthesis();
  const language = i18n.language;
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [connectingMicrophone, setConnectingMicrophone] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingError, setRecordingError] = useState('');
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const recordingStartedAtRef = useRef(0);
  const recordingTimerRef = useRef(null);
  const startingRef = useRef(false);
  const recordingFailedRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const mountedRef = useRef(true);
  const assistantLanguage = LANGUAGES.some(({ code }) => code === language)
    ? language
    : language.split('-')[0];
  const recordingSupported = typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof window !== 'undefined'
    && Boolean(window.MediaRecorder);
  const changeLanguage = async (event) => {
    const nextLanguage = event.target.value;
    await i18n.changeLanguage(nextLanguage);
    if (user) {
      try {
        await api.put('/languages/preference', { language_code: nextLanguage });
      } catch {
        notify(t('phase10.languageSaveFailed'), 'error');
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      window.clearTimeout(recordingTimerRef.current);
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const transcribeRecording = async (blob, durationSeconds) => {
    if (!blob.size) {
      setRecordingError('voiceNoSpeech');
      setTranscribing(false);
      return;
    }
    setTranscribing(true);
    setRecordingError('');
    try {
      const formData = new FormData();
      const extension = blob.type.split(';')[0] === 'audio/wav' ? 'wav' : 'webm';
      formData.append('audio', blob, `voice-question.${extension}`);
      formData.append('language', `${assistantLanguage}-IN`);
      formData.append('duration_seconds', String(durationSeconds));
      const { data } = await api.post('/voice/speech-to-text', formData, { timeout: 45_000 });
      if (!mountedRef.current) return;
      const transcript = data.data.transcript.trim();
      setText((currentText) => {
        const previousText = currentText.trimEnd();
        return [previousText, transcript]
          .filter(Boolean)
          .join(previousText ? ' ' : '')
          .slice(0, 2000);
      });
    } catch (requestError) {
      if (!mountedRef.current) return;
      const code = requestError.response?.data?.code;
      setRecordingError(code === 'SERVER_STT_UNAVAILABLE'
        ? 'voiceTranscriptionUnavailable'
        : code === 'GEMINI_QUOTA_EXCEEDED'
          ? 'voiceQuotaExceeded'
          : code === 'GEMINI_AUTH_FAILED'
            ? 'voiceGeminiKeyFailed'
            : code === 'GEMINI_MODEL_UNAVAILABLE'
              ? 'voiceGeminiModelFailed'
          : 'voiceTranscriptionFailed');
    } finally {
      if (mountedRef.current) setTranscribing(false);
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    window.clearTimeout(recordingTimerRef.current);
    recorder.stop();
  };

  const startSpeaking = async () => {
    if (startingRef.current || recording || transcribing || assistantBusy) return;
    if (!recordingSupported) {
      setRecordingError('voiceRecordingUnavailable');
      return;
    }
    startingRef.current = true;
    setConnectingMicrophone(true);
    setRecordingError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/wav']
        .find((type) => window.MediaRecorder.isTypeSupported?.(type));
      const recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const recordingMimeType = recorder.mimeType || mimeType || '';
      if (!['audio/webm', 'audio/wav'].includes(recordingMimeType.split(';')[0])) {
        throw new Error('Unsupported recording format');
      }
      const chunks = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        recordingFailedRef.current = true;
        if (recorder.state !== 'inactive') recorder.stop();
      };
      recorder.onstop = () => {
        const recordingFailed = recordingFailedRef.current;
        const discardRecording = discardRecordingRef.current;
        recorderRef.current = null;
        startingRef.current = false;
        recordingFailedRef.current = false;
        discardRecordingRef.current = false;
        window.clearTimeout(recordingTimerRef.current);
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
        if (!mountedRef.current) return;
        setRecording(false);
        if (recordingFailed || discardRecording) {
          if (recordingFailed) setRecordingError('voiceRecordingFailed');
          return;
        }
        if (!chunks.length) {
          setRecordingError('voiceNoSpeech');
          return;
        }
        const durationSeconds = Math.max(
          1,
          Math.min(60, Math.ceil((Date.now() - recordingStartedAtRef.current) / 1000)),
        );
        void transcribeRecording(
          new Blob(chunks, { type: recordingMimeType }),
          durationSeconds,
        );
      };
      recorder.start();
      recordingStartedAtRef.current = Date.now();
      recordingFailedRef.current = false;
      discardRecordingRef.current = false;
      startingRef.current = false;
      setConnectingMicrophone(false);
      setRecording(true);
      recordingTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current && recorderRef.current === recorder && recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, 60_000);
    } catch (error) {
      startingRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (mountedRef.current) {
        setConnectingMicrophone(false);
        setRecordingError(error.name === 'NotAllowedError' || error.name === 'SecurityError'
          ? 'voicePermissionDenied'
          : error.name === 'NotFoundError'
            ? 'voiceMicrophoneUnavailable'
            : 'voiceRecordingFailed');
      }
    }
  };

  const clearText = () => {
    discardRecordingRef.current = true;
    stopRecording();
    setText('');
  };

  const askGemini = async (event) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || assistantBusy) return;

    setAssistantBusy(true);
    setAssistantError('');
    try {
      const { data } = await api.post('/language/translate', {
        text: message,
        source_lang: assistantLanguage,
        target_lang: assistantLanguage,
        mode: 'chat',
        history: assistantMessages.slice(-6),
      });
      const answer = data.data.translated_text;
      setAssistantMessages((items) => [
        ...items,
        { role: 'user', text: message },
        { role: 'assistant', text: answer },
      ].slice(-12));
      setText('');
      speech.speak(answer, assistantLanguage);
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setAssistantError(code === 'CHATBOT_INPUT_PRIVATE'
        ? t('phase10.chatbotPrivateError')
        : code === 'CHATBOT_UNAVAILABLE'
          ? t('phase10.chatbotUnavailable')
          : t('phase10.chatbotError'));
    } finally {
      setAssistantBusy(false);
    }
  };

  const clearConversation = () => {
    speech.stop();
    setAssistantMessages([]);
    setAssistantError('');
  };

  return (
    <div className="phase10-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('phase10.voiceTitle')}</p>
          <h1>{t('phase10.voiceTitle')}</h1>
          <p>{t('phase10.voiceDescription')}</p>
        </div>
      </div>
      <Card className="voice-card">
        <VoiceGuidanceToggle speechController={speech} />
        <label className="field" htmlFor="voice-language">
          <span className="field__label">{t('phase10.voiceLanguage')}</span>
          <select
            className="field__control"
            id="voice-language"
            onChange={(event) => void changeLanguage(event)}
            value={language}
          >
              {LANGUAGES.map(({ code, name }) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
        <p className="auth-hint">{t('phase10.voiceInstructions')}</p>
      </Card>
      {language === 'or' && <p className="phase10-disclaimer" role="note">{t('phase10.voiceTextFallback')}</p>}
      {!recordingSupported && (
        <p className="form-error" role="alert">{t('phase10.voiceRecordingUnavailable')}</p>
      )}
      {recordingError && <p className="form-error" role="alert">{t(`phase10.${recordingError}`)}</p>}
      <Card className="voice-card">
        <div>
          <h2>{t('phase10.geminiVoiceTitle')}</h2>
          <p>{t('phase10.geminiVoiceDescription')}</p>
        </div>
        <p className="phase10-disclaimer" role="note">{t('phase10.geminiVoiceMode')}</p>
        <p className="phase10-disclaimer" role="note">{t('phase10.chatbotPrivacyNotice')}</p>
        <p className="phase10-disclaimer" role="note">{t('phase10.chatbotDisclaimer')}</p>
        <Button
            aria-pressed={recording}
            className="voice-microphone"
            disabled={!recordingSupported || connectingMicrophone || transcribing || assistantBusy}
            onClick={recording ? stopRecording : () => void startSpeaking()}
            type="button"
        >
            {connectingMicrophone || transcribing
              ? <span aria-hidden="true" className="voice-support-spinner" />
              : recording
                ? <MicOff aria-hidden="true" />
                : <Mic aria-hidden="true" />}
            {connectingMicrophone
              ? t('phase10.voiceStarting')
              : transcribing
              ? t('phase10.voiceTranscribing')
              : recording
                ? t('phase10.stopAndTranscribe')
                : t('phase10.microphone')}
        </Button>
        <p aria-live="polite" className="voice-support-status" role="status">
            {connectingMicrophone
              ? t('phase10.voiceStarting')
              : transcribing
              ? t('phase10.voiceTranscribing')
              : recording
                ? t('phase10.voiceListening')
                : speech.speaking
                  ? t('phase10.voiceSpeaking')
                  : ''}
        </p>
        <p className="auth-hint">{t('phase10.voiceRecordingPrivacy')}</p>
        <label className="field-label" htmlFor="voice-transcript">{t('phase10.speechText')}</label>
        <textarea
            id="voice-transcript"
            lang={language}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            value={text}
        />
        <form className="chatbot-form" onSubmit={(event) => void askGemini(event)}>
          <Button
            disabled={assistantBusy || !text.trim() || recording || transcribing}
            type="submit"
          >
            <Send aria-hidden="true" />
            {assistantBusy ? t('phase10.geminiVoiceThinking') : t('phase10.geminiVoiceAsk')}
          </Button>
          {assistantError && <p className="form-error" role="alert">{assistantError}</p>}
        </form>
        {assistantMessages.length > 0 && (
          <div aria-live="polite" className="chatbot-messages">
            {assistantMessages.map((message, index) => (
              <p
                className={`chatbot-message chatbot-message--${message.role}`}
                key={`${index}-${message.role}`}
              >
                <strong>{t(message.role === 'user'
                  ? 'phase10.chatbotYou'
                  : 'phase10.chatbotAssistant')}</strong>
                <span lang={assistantLanguage}>{message.text}</span>
              </p>
            ))}
            <Button onClick={clearConversation} type="button" variant="outline">
              {t('phase10.geminiVoiceClear')}
            </Button>
          </div>
        )}
        <div className="voice-support-actions">
            <Button
              disabled={!text.trim() || speech.speaking || connectingMicrophone || recording || transcribing}
              onClick={() => speech.speak(text, language)}
              type="button"
              variant="outline"
            >
              <Volume2 aria-hidden="true" />
              {t('phase10.speakText')}
            </Button>
            <Button
              disabled={!speech.speaking}
              onClick={speech.stop}
              type="button"
              variant="outline"
            >
              <VolumeX aria-hidden="true" />
              {t('phase10.stopAudio')}
            </Button>
            <Button
              disabled={!text}
              onClick={clearText}
              type="button"
              variant="outline"
            >
              <Eraser aria-hidden="true" />
              {t('phase10.clearText')}
            </Button>
        </div>
        {!text && !speech.speaking && (
          <p className="auth-hint">{t('phase10.voiceActionsHint')}</p>
        )}
        {speech.error && <p className="form-error" role="alert">{t('phase10.speechUnavailable')}</p>}
      </Card>
    </div>
  );
}
