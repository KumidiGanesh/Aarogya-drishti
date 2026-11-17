import { useCallback, useEffect, useRef, useState } from 'react';

const LANGUAGE_TAGS = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN', or: 'or-IN' };

export default function useSpeechSynthesis() {
  const utteranceRef = useRef(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');

  const stop = useCallback(() => {
    const utterance = utteranceRef.current;
    utteranceRef.current = null;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback((text, language = 'en') => {
    stop();
    setError('');
    if (!text.trim()) return;
    if (
      typeof window === 'undefined' ||
      !window.speechSynthesis ||
      !window.SpeechSynthesisUtterance
    ) {
      setError('unavailable');
      return;
    }

    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = LANGUAGE_TAGS[language] || LANGUAGE_TAGS.en;
    utterance.onend = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setSpeaking(false);
    };
    utterance.onerror = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setSpeaking(false);
      setError('unavailable');
    };
    utteranceRef.current = utterance;
    setSpeaking(true);
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      utteranceRef.current = null;
      setSpeaking(false);
      setError('unavailable');
    }
  }, [stop]);

  useEffect(() => () => {
    const utterance = utteranceRef.current;
    utteranceRef.current = null;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
    }
  }, []);

  return { speaking, error, speak, stop };
}
