import { useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useSpeechRecognition from '../hooks/useSpeechRecognition.js';

export default function VoiceDictationButton({ fieldLabel, language, onTranscript }) {
  const { t } = useTranslation();
  const recognition = useSpeechRecognition(language);
  const lastAppliedTranscript = useRef('');

  useEffect(() => {
    if (
      !recognition.listening
      && recognition.transcript
      && recognition.transcript !== lastAppliedTranscript.current
    ) {
      lastAppliedTranscript.current = recognition.transcript;
      onTranscript(recognition.transcript);
    }
  }, [onTranscript, recognition.listening, recognition.transcript]);

  const errorMessage = recognition.error === 'permission-denied'
    ? t('phase10.voicePermissionDenied')
    : recognition.error === 'recognition-failed'
      ? t('phase10.voiceRecognitionFailed')
      : '';
  const label = t('phase10.dictateField', { field: fieldLabel });
  const start = () => {
    lastAppliedTranscript.current = '';
    recognition.start();
  };

  return (
    <span className="voice-dictation">
      <button
        aria-label={label}
        aria-pressed={recognition.listening}
        className="voice-dictation__button"
        disabled={!recognition.supported}
        onClick={recognition.listening ? recognition.stop : start}
        title={recognition.supported ? label : t('phase10.voiceUnavailable')}
        type="button"
      >
        {recognition.listening
          ? <MicOff aria-hidden="true" size={18} />
          : <Mic aria-hidden="true" size={18} />}
        {recognition.listening ? t('phase10.stopMicrophone') : t('phase10.dictate')}
      </button>
      {errorMessage && <span className="voice-dictation__error" role="status">{errorMessage}</span>}
    </span>
  );
}
