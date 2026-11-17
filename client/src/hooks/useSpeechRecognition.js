import { useCallback, useEffect, useRef, useState } from 'react';

const LANGUAGE_TAGS = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN', or: 'or-IN' };

function recognitionConstructor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function errorCode(error) {
  if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'security')
    return 'permission-denied';
  if (error === 'audio-capture') return 'microphone-unavailable';
  if (error === 'network') return 'network-error';
  if (error === 'no-speech') return 'no-speech';
  if (error === 'aborted') return '';
  return 'recognition-failed';
}

export default function useSpeechRecognition(language = 'en') {
  const recognitionRef = useRef(null);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const supported = Boolean(recognitionConstructor());

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      if (startingRef.current) recognition.abort();
      else recognition.stop();
    } catch {
      recognitionRef.current = null;
      startingRef.current = false;
      setLoading(false);
      setListening(false);
      setError('recognition-failed');
    }
  }, []);

  const start = useCallback(() => {
    if (recognitionRef.current || startingRef.current) return;
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      setError('unavailable');
      return;
    }

    let recognition;
    try {
      recognition = new Recognition();
      recognition.lang = LANGUAGE_TAGS[language] || LANGUAGE_TAGS.en;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onstart = () => {
        if (!mountedRef.current || recognitionRef.current !== recognition) return;
        startingRef.current = false;
        setLoading(false);
        setListening(true);
      };
      recognition.onresult = (event) => {
        if (!mountedRef.current || recognitionRef.current !== recognition) return;
        const finalParts = [];
        const interimParts = [];
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const value = result[0]?.transcript?.trim();
          if (!value) continue;
          (result.isFinal ? finalParts : interimParts).push(value);
        }
        setTranscript([...finalParts, ...interimParts].join(' '));
      };
      recognition.onerror = (event) => {
        if (!mountedRef.current || recognitionRef.current !== recognition) return;
        const nextError = errorCode(event.error);
        if (nextError) setError(nextError);
        startingRef.current = false;
        setLoading(false);
        setListening(false);
      };
      recognition.onend = () => {
        if (!mountedRef.current || recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        startingRef.current = false;
        setLoading(false);
        setListening(false);
      };

      recognitionRef.current = recognition;
      startingRef.current = true;
      setTranscript('');
      setError('');
      setLoading(true);
      recognition.start();
    } catch (startError) {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      startingRef.current = false;
      setLoading(false);
      setListening(false);
      setError(errorCode(startError.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed'));
    }
  }, [language]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startingRef.current = false;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition?.abort();
    };
  }, []);

  return { supported, listening, loading, transcript, error, start, stop, setTranscript };
}
