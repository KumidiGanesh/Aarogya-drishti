import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Mic, MicOff, Search, ShieldCheck, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Select from '../components/ui/Select.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';
import { enqueueScreening } from '../offline/screeningQueue.js';
import { inspectImage } from '../screenings/imageQuality.js';
import useSpeechRecognition from '../hooks/useSpeechRecognition.js';

const SYMPTOMS = [
  'mouth_ulcer',
  'white_patch',
  'red_patch',
  'pain',
  'burning',
  'difficulty_opening_mouth',
  'bleeding_gums',
  'swelling',
  'loose_tooth',
  'bad_breath',
  'difficulty_swallowing',
  'tobacco_use',
];
const SPOKEN_SYMPTOMS = [
  ['mouth_ulcer', ['mouth ulcer', 'mouth sore', 'నోటి పుండు', 'నోటి పుండ్లు', 'मुंह के छाले', 'ମୁଖ ଘା']],
  ['white_patch', ['white patch', 'తెల్ల మచ్చ', 'తెల్లటి మచ్చ', 'सफेद धब्बा', 'ଧଳା ଦାଗ']],
  ['red_patch', ['red patch', 'ఎర్ర మచ్చ', 'लाल धब्बा', 'ନାଲି ଦାଗ']],
  ['pain', ['pain', 'నొప్పి', 'दर्द', 'ଯନ୍ତ୍ରଣା']],
  ['burning', ['burning', 'నోటి మంట', 'మంట', 'जलन', 'ପୋଡ଼ା']],
  ['difficulty_opening_mouth', ['difficulty opening mouth', 'నోరు తెరవడం కష్టం', 'मुंह खोलने में कठिनाई', 'ପାଟି ଖୋଲିବାରେ ଅସୁବିଧା']],
  ['bleeding_gums', ['bleeding gums', 'చిగుళ్ల నుంచి రక్తం', 'मसूड़ों से खून', 'ମାଢ଼ିରୁ ରକ୍ତ']],
  ['swelling', ['swelling', 'వాపు', 'सूजन', 'ଫୁଲା']],
  ['loose_tooth', ['loose tooth', 'పంటి కదలిక', 'दाँत हिलना', 'ଦାନ୍ତ ହଲିବା']],
  ['bad_breath', ['bad breath', 'నోటి దుర్వాసన', 'मुंह से बदबू', 'ପାଟିରୁ ଦୁର୍ଗନ୍ଧ']],
  ['difficulty_swallowing', ['difficulty swallowing', 'మింగడం కష్టం', 'निगलने में कठिनाई', 'ଗିଳିବାରେ ଅସୁବିଧା']],
  ['tobacco_use', ['tobacco', 'gutkha', 'పొగాకు', 'గుట్కా', 'तंबाकू', 'गुटखा', 'ତମାଖୁ', 'ଗୁଟଖା']],
];
const SITES = ['front', 'left_cheek', 'right_cheek', 'tongue', 'upper_gum', 'lower_gum', 'other'];
function createUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export default function ScreeningWorkflowPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const isPatient = user.role === 'patient';
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState([]);
  const [patientSelfLoading, setPatientSelfLoading] = useState(false);
  const [patientSearchFailed, setPatientSearchFailed] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [consents, setConsents] = useState({
    data_collection: false,
    photo: false,
    ai_processing: false,
  });
  const [symptoms, setSymptoms] = useState({});
  const [typedSymptom, setTypedSymptom] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [site, setSite] = useState('front');
  const [acceptLowQuality, setAcceptLowQuality] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorText, setErrorText] = useState('');
  const [pendingVoiceTranscript, setPendingVoiceTranscript] = useState('');
  const voiceRecognition = useSpeechRecognition(i18n.language);
  const stopVoiceRecognition = voiceRecognition.stop;
  const photoUrlsRef = useRef(new Set());
  const cameraStreamRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraRequestRef = useRef(0);
  const clientUuidRef = useRef(createUuid());
  const [serverQualityWarning, setServerQualityWarning] = useState(false);
  const searchId = 'screening-patient-search';

  useEffect(() => {
    if (voiceRecognition.transcript && !voiceRecognition.listening) {
      setPendingVoiceTranscript(voiceRecognition.transcript);
    }
  }, [voiceRecognition.listening, voiceRecognition.transcript]);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(async () => {
      if (isPatient) {
        setPatientSelfLoading(true);
        try {
          const { data } = await api.get('/auth/profile');
          const profile = data.data.user.profile;
          if (!profile?.id) throw new Error('Patient profile is unavailable');
          if (active) {
            setSelectedPatient({
              ...profile,
              full_name: profile.full_name || user.full_name,
            });
            setPatientSearchFailed(false);
          }
        } catch {
          if (active) {
            setSelectedPatient(null);
            setPatientSearchFailed(true);
          }
        } finally {
          if (active) setPatientSelfLoading(false);
        }
        return;
      }
      try {
        const { data } = await api.get('/patients', {
          params: { page: 1, limit: 10, ...(query.trim() ? { search: query.trim() } : {}) },
        });
        if (active) {
          setPatients(data.data.items || []);
          setPatientSearchFailed(false);
        }
      } catch {
        if (active) {
          setPatients([]);
          setPatientSearchFailed(true);
        }
      }
    }, isPatient ? 0 : 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [isPatient, query, user.full_name]);

  useEffect(() => {
    if (cameraVideoRef.current && cameraStreamRef.current) {
      cameraVideoRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraActive]);

  useEffect(() => () => {
      stopVoiceRecognition();
      cameraRequestRef.current += 1;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      photoUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      photoUrlsRef.current.clear();
    }, [stopVoiceRecognition]);

  const stopCamera = () => {
    cameraRequestRef.current += 1;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraActive(false);
    setCameraBusy(false);
  };

  const startCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t('screening.cameraUnavailable'));
      return;
    }
    const requestId = cameraRequestRef.current + 1;
    cameraRequestRef.current = requestId;
    setCameraBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStreamRef.current = stream;
      setCameraActive(true);
    } catch (cameraRequestError) {
      if (requestId !== cameraRequestRef.current) return;
      const messageKey =
        cameraRequestError.name === 'NotAllowedError' || cameraRequestError.name === 'SecurityError'
          ? 'cameraPermissionDenied'
          : 'cameraUnavailable';
      setCameraError(t(`screening.${messageKey}`));
    } finally {
      if (requestId === cameraRequestRef.current) setCameraBusy(false);
    }
  };

  const captureCameraPhoto = async () => {
    const video = cameraVideoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) {
      setCameraError(t('screening.cameraNotReady'));
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError(t('screening.cameraCaptureFailed'));
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      setCameraError(t('screening.cameraCaptureFailed'));
      return;
    }
    const timestamp = Date.now();
    const file = new File([blob], `oral-screening-${timestamp}.jpg`, {
      type: 'image/jpeg',
      lastModified: timestamp,
    });
    await choosePhotos([file]);
    setCameraError('');
  };

  const choosePhotos = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length + photos.length > 6) {
      setErrorText(t('screening.imagesMax'));
      return;
    }
    if (files.some((file) => file.size > 8 * 1024 * 1024)) {
      setErrorText(t('screening.fileTooLarge'));
      return;
    }
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setErrorText(t('screening.photoTypeInvalid'));
      return;
    }
    const checked = await Promise.all(
      files.map(async (file) => {
        const preview = URL.createObjectURL(file);
        photoUrlsRef.current.add(preview);
        return { file, preview, quality: await inspectImage(file) };
      }),
    );
    setPhotos((current) => [...current, ...checked]);
    setAcceptLowQuality(false);
    setServerQualityWarning(false);
    setErrorText('');
  };

  const handlePhotoChange = (event) => {
    void choosePhotos(event.currentTarget.files);
    event.currentTarget.value = '';
  };

  const removePhoto = (index) => {
    setAcceptLowQuality(false);
    setServerQualityWarning(false);
    setPhotos((current) => {
      const removed = current[index];
      photoUrlsRef.current.delete(removed.preview);
      URL.revokeObjectURL(removed.preview);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const updateSymptom = (code, updates) => {
    setSymptoms((current) => ({
      ...current,
      [code]: {
        severity: 'moderate',
        duration_days: 0,
        entered_via: 'typed',
        ...current[code],
        ...updates,
      },
    }));
  };

  const addTypedSymptom = (value, enteredVia = 'typed') => {
    const text = value.trim();
    if (!text) return;
    const slug = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    updateSymptom(`symptom_${slug || 'voice_input'}`, {
      entered_via: enteredVia,
      display_name: text,
    });
    if (enteredVia === 'typed') setTypedSymptom('');
  };

  const symptomEntries = Object.entries(symptoms).map(
    ([code, { severity, duration_days, entered_via }]) => ({
      code,
      severity,
      duration_days,
      entered_via,
    }),
  );
  const hasLowQuality =
    serverQualityWarning ||
    photos.some(({ quality }) => quality.notes.length > 0 || quality.score < 0.5);

  const saveOffline = async (payload, screeningId = null) => {
    await enqueueScreening(
      payload,
      screeningId,
      photos.map(({ file }) => file),
      site,
    );
    notify(t('screening.savedOffline'), 'success');
    navigate('/screenings');
  };

  const submit = async () => {
    if (
      !selectedPatient
      || symptomEntries.length === 0
      || isPatient && (
        !consents.data_collection
        || !consents.photo
        || photos.length === 0
      )
    ) return;
    const payload = {
      patient_id: selectedPatient.id,
      symptoms: symptomEntries,
      notes,
      client_uuid: clientUuidRef.current,
    };
    setBusy(true);
    setErrorText('');
    try {
      if (!navigator.onLine) {
        if (isPatient) {
          setErrorText(t('screening.patientRequiresOnline'));
          return;
        }
        await saveOffline(payload);
        return;
      }
      if (isPatient) {
        const language = ['en', 'te', 'hi', 'or'].includes(i18n.language.slice(0, 2))
          ? i18n.language.slice(0, 2)
          : 'en';
        for (const consentType of ['data_collection', 'photo', 'ai_processing']) {
          await api.post(`/patients/${selectedPatient.id}/consent`, {
            consent_type: consentType,
            granted: consentType === 'ai_processing'
              ? consents.ai_processing
              : true,
            version: 1,
            language,
          });
        }
      }
      const { data } = await api.post('/screenings', payload);
      const screeningId = data.data.screening.id;
      if (photos.length) {
        const formData = new FormData();
        formData.append('site', site);
        formData.append('accept_low_quality', String(acceptLowQuality));
        photos.forEach(({ file }) => formData.append('images', file));
        try {
          await api.post(`/screenings/${screeningId}/upload-image`, formData, {
            onUploadProgress: (event) => {
              if (event.total) setProgress(Math.round((event.loaded * 100) / event.total));
            },
          });
        } catch (error) {
          if ((!error.response || !navigator.onLine) && !isPatient) {
            await saveOffline(payload, screeningId);
            return;
          }
          if (error.response?.data?.code === 'LOW_IMAGE_QUALITY') {
            setServerQualityWarning(true);
            setAcceptLowQuality(false);
          }
          const validationMessage = !error.response || !navigator.onLine
            ? t('screening.screeningFailed')
            : error.response?.data?.errors?.[0]?.advice
              || error.response?.data?.message
              || t('screening.photoConsentRequired');
          setErrorText(validationMessage);
          setBusy(false);
          return;
        }
        if (isPatient && consents.ai_processing) {
          try {
            await api.post(`/screenings/${screeningId}/ai-analysis`);
          } catch (error) {
            notify(error.response?.data?.message || t('screening.aiFailed'), 'error');
          }
        }
      }
      navigate(`/screenings/${screeningId}`);
    } catch (error) {
      if (!isPatient && (!error.response || !navigator.onLine)) {
        try {
          await saveOffline(payload);
        } catch {
          setErrorText(t('screening.screeningFailed'));
        }
      } else {
        setErrorText(
          error.response?.data?.message ||
            (error.response?.status === 422
              ? t('screening.consentRequired')
              : t('screening.screeningFailed')),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const stepTitles = [
    t(isPatient ? 'screening.patientConsentStep' : 'screening.patientStep'),
    t('screening.symptomsStep'),
    t('screening.photosStep'),
  ];

  return (
    <div className="screening-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t('screening.title')}</p>
          <h1>{t('screening.start')}</h1>
          <p className="page-heading__description">{t('screening.description')}</p>
        </div>
      </header>
      <ol aria-label={t('screening.title')} className="screening-stepper">
        {stepTitles.map((title, index) => (
          <li aria-current={index === step ? 'step' : undefined} key={title}>
            <span>{index + 1}</span>
            <strong>{title}</strong>
          </li>
        ))}
      </ol>
      {step === 0 && (
        <Card className="screening-card">
          <h2>{t(isPatient ? 'screening.patientConsentStep' : 'screening.patientStep')}</h2>
          {isPatient ? (
            <>
              {patientSelfLoading && <p>{t('loading')}</p>}
              {selectedPatient && (
                <div className="screening-patient-choice screening-patient-choice--active">
                  <strong>{selectedPatient.full_name}</strong>
                  {selectedPatient.patient_code && <span>{selectedPatient.patient_code}</span>}
                </div>
              )}
              {patientSearchFailed && (
                <p className="auth-error" role="alert">{t('screening.patientSearchFailed')}</p>
              )}
              <fieldset className="screening-consent-list">
                <legend>{t('screening.patientConsentTitle')}</legend>
                <p>{t('screening.patientConsentDescription')}</p>
                {[
                  ['data_collection', 'screening.dataConsent'],
                  ['photo', 'screening.photoConsent'],
                  ['ai_processing', 'screening.aiConsent'],
                ].map(([consentType, labelKey]) => (
                  <label className="screening-consent-item" key={consentType}>
                    <input
                      checked={consents[consentType]}
                      onChange={(event) => setConsents((current) => ({
                        ...current,
                        [consentType]: event.target.checked,
                      }))}
                      type="checkbox"
                    />
                    <span>{t(labelKey)}</span>
                  </label>
                ))}
              </fieldset>
            </>
          ) : (
            <>
          <label className="field" htmlFor={searchId}>
            <span className="field__label">{t('screening.patientSearch')}</span>
            <span className="screening-search">
              <Search aria-hidden="true" size={18} />
              <input
                autoComplete="off"
                className="field__control"
                id={searchId}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('screening.patientSearch')}
                value={query}
              />
            </span>
          </label>
          <div className="screening-patient-grid">
            {patients.map((patient) => (
              <button
                aria-pressed={selectedPatient?.id === patient.id}
                className={`screening-patient-choice ${
                  selectedPatient?.id === patient.id ? 'screening-patient-choice--active' : ''
                }`}
                key={patient.id}
                onClick={() => {
                  if (selectedPatient && selectedPatient.id !== patient.id) {
                    photoUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
                    photoUrlsRef.current.clear();
                    setPhotos([]);
                    setSymptoms({});
                    setNotes('');
                    setAcceptLowQuality(false);
                    setServerQualityWarning(false);
                    clientUuidRef.current = createUuid();
                  }
                  setSelectedPatient(patient);
                }}
                type="button"
              >
                <strong>{patient.full_name}</strong>
                <span>{patient.patient_code}</span>
                <span>{patient.mobile}</span>
              </button>
            ))}
            {!patients.length && (
              <p role={patientSearchFailed ? 'alert' : undefined}>
                {t(patientSearchFailed ? 'screening.patientSearchFailed' : 'screening.noPatients')}
              </p>
            )}
          </div>
            </>
          )}
          <Button
            disabled={
              !selectedPatient
              || isPatient && (
                patientSelfLoading
                || !consents.data_collection
                || !consents.photo
              )
            }
            onClick={() => setStep(1)}
            type="button"
          >
            {t('screening.continue')}
          </Button>
        </Card>
      )}
      {step === 1 && (
        <Card className="screening-card">
          <h2>{t('screening.chooseSymptoms')}</h2>
          <div className="screening-symptom-grid">
            {SYMPTOMS.map((code) => {
              const active = Boolean(symptoms[code]);
              return (
                <div className="screening-symptom-item" key={code}>
                  <button
                    aria-pressed={active}
                    className={`screening-symptom-chip ${active ? 'screening-symptom-chip--active' : ''}`}
                    onClick={() =>
                      setSymptoms((current) => {
                        const next = { ...current };
                        if (next[code]) delete next[code];
                        else next[code] = { severity: 'moderate', duration_days: 0, entered_via: 'typed' };
                        return next;
                      })
                    }
                    type="button"
                  >
                    {t(`screening.symptomNames.${code}`)}
                  </button>
                  {active && (
                    <div className="screening-symptom-controls">
                      <Select
                        id={`${code}-severity`}
                        label={t('screening.severity')}
                        onChange={(event) => updateSymptom(code, { severity: event.target.value })}
                        value={symptoms[code].severity}
                      >
                        {['mild', 'moderate', 'severe'].map((value) => (
                          <option key={value} value={value}>
                            {t(`screening.${value}`)}
                          </option>
                        ))}
                      </Select>
                      <Input
                        id={`${code}-duration`}
                        label={t('screening.symptomDuration')}
                        min="0"
                        onChange={(event) =>
                          updateSymptom(code, { duration_days: Number(event.target.value) || 0 })
                        }
                        type="number"
                        value={symptoms[code].duration_days}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="screening-voice-entry">
            <Input
              id="screening-typed-symptom"
              label={t('screening.typedSymptom')}
              onChange={(event) => setTypedSymptom(event.target.value)}
              value={typedSymptom}
            />
            <Button
              disabled={!typedSymptom.trim()}
              onClick={() => addTypedSymptom(typedSymptom)}
              type="button"
              variant="outline"
            >
              {t('screening.addTypedSymptom')}
            </Button>
            <Button
              aria-pressed={voiceRecognition.listening}
              disabled={!voiceRecognition.supported}
              onClick={() => {
                setPendingVoiceTranscript('');
                voiceRecognition.listening ? voiceRecognition.stop() : voiceRecognition.start();
              }}
              type="button"
              variant="outline"
            >
              {voiceRecognition.listening ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
              {voiceRecognition.listening ? t('screening.voiceListening') : t('screening.voiceEntry')}
            </Button>
          </div>
          {!voiceRecognition.supported && (
            <p role="status">{t('screening.voiceUnavailable')}</p>
          )}
          {voiceRecognition.error === 'permission-denied' && (
            <p role="alert">{t('phase10.voicePermissionDenied')}</p>
          )}
          {voiceRecognition.error === 'recognition-failed' && (
            <p role="alert">{t('screening.voiceFailed')}</p>
          )}
          {pendingVoiceTranscript && (
            <div className="voice-confirmation" role="group" aria-label={t('phase10.transcript')}>
              <p>{pendingVoiceTranscript}</p>
              <Button
                onClick={() => {
                  const spoken = pendingVoiceTranscript.toLocaleLowerCase();
                  const catalogCode = SPOKEN_SYMPTOMS.find(([, phrases]) =>
                    phrases.some((phrase) => spoken.includes(phrase.toLocaleLowerCase())),
                  )?.[0];
                  if (catalogCode) {
                    updateSymptom(catalogCode, { entered_via: 'voice' });
                  } else {
                    addTypedSymptom(pendingVoiceTranscript, 'voice');
                  }
                  setPendingVoiceTranscript('');
                }}
                type="button"
              >
                {t('phase10.confirmVoiceSymptom')}
              </Button>
            </div>
          )}
          {Object.entries(symptoms)
            .filter(([code]) => code.startsWith('symptom_'))
            .map(([code, value]) => (
              <div className="screening-custom-symptom" key={code}>
                <span>{value.display_name || code.replace(/^symptom_/, '').replaceAll('_', ' ')}</span>
                <span>{t(`screening.${value.entered_via}`)}</span>
                <button
                  aria-label={`${t('screening.removeSymptom')}: ${code}`}
                  onClick={() =>
                    setSymptoms((current) => {
                      const next = { ...current };
                      delete next[code];
                      return next;
                    })
                  }
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
            ))}
          <label className="field" htmlFor="screening-notes">
            <span className="field__label">{t('screening.notes')}</span>
            <textarea
              className="field__control screening-textarea"
              id="screening-notes"
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              value={notes}
            />
          </label>
          {errorText && <p className="screening-error" role="alert">{errorText}</p>}
          <div className="screening-actions">
            <Button onClick={() => setStep(0)} type="button" variant="outline">
              {t('screening.back')}
            </Button>
            <Button
              disabled={!symptomEntries.length}
              onClick={() => setStep(2)}
              type="button"
            >
              {t('screening.continue')}
            </Button>
          </div>
        </Card>
      )}
      {step === 2 && (
        <Card className="screening-card">
          <h2>{t('screening.photosStep')}</h2>
          <p>{t('screening.photosDescription')}</p>
          <aside className="screening-photo-guidance">
            <ShieldCheck aria-hidden="true" size={22} />
            <div>
              <strong>{t('screening.photoGuidance')}</strong>
              <p>{t('screening.photoAngle')}</p>
            </div>
          </aside>
          <Select
            id="screening-image-site"
            label={t('screening.site')}
            onChange={(event) => setSite(event.target.value)}
            value={site}
          >
            {SITES.map((value) => (
              <option key={value} value={value}>
                {t(`screening.${value === 'left_cheek' ? 'leftCheek' : value === 'right_cheek' ? 'rightCheek' : value === 'upper_gum' ? 'upperGum' : value === 'lower_gum' ? 'lowerGum' : value}`)}
              </option>
            ))}
          </Select>
          <div className="screening-photo-actions">
            {!cameraActive ? (
              <Button disabled={cameraBusy} onClick={() => void startCamera()} type="button" variant="outline">
                <Camera aria-hidden="true" size={19} />
                {cameraBusy ? t('screening.cameraStarting') : t('screening.startLiveCamera')}
              </Button>
            ) : (
              <Button onClick={stopCamera} type="button" variant="outline">
                <Camera aria-hidden="true" size={19} />
                {t('screening.stopLiveCamera')}
              </Button>
            )}
            <label className="button button--outline screening-file-button">
              <Camera aria-hidden="true" size={19} />
              {t('screening.camera')}
              <input
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                multiple
                onChange={handlePhotoChange}
                type="file"
              />
            </label>
            <label className="button button--outline screening-file-button">
              <Upload aria-hidden="true" size={19} />
              {t('screening.gallery')}
              <input
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handlePhotoChange}
                type="file"
              />
            </label>
          </div>
          {cameraActive && (
            <div className="screening-live-camera">
              <video
                autoPlay
                aria-label={t('screening.liveCameraPreview')}
                className="screening-live-camera__preview"
                muted
                playsInline
                ref={cameraVideoRef}
              />
              <Button onClick={() => void captureCameraPhoto()} type="button">
                <Camera aria-hidden="true" size={19} />
                {t('screening.capturePhoto')}
              </Button>
            </div>
          )}
          {cameraError && <p className="screening-error" role="alert">{cameraError}</p>}
          {photos.length === 0 && <p>{t('screening.noPhotos')}</p>}
          <div className="screening-photo-grid">
            {photos.map(({ file, preview, quality }, index) => (
              <article className="screening-photo-card" key={`${file.name}-${file.lastModified}`}>
                <img alt={`${t('screening.images')} ${index + 1}`} src={preview} />
                <div>
                  {quality.notes.length || quality.score < 0.5 ? (
                    <>
                      <strong>{t('screening.qualityLow')}</strong>
                      <ul>
                        {quality.notes.map((note) => {
                          const labels = {
                            too_small: 'qualityTooSmall',
                            blurry: 'qualityBlurry',
                            too_dark: 'qualityTooDark',
                            too_bright: 'qualityTooBright',
                            invalid_type: 'qualityInvalid',
                          };
                          return <li key={note}>{t(`screening.${labels[note] || 'qualityInvalid'}`)}</li>;
                        })}
                      </ul>
                    </>
                  ) : (
                    <strong>{t('screening.qualityGood')}</strong>
                  )}
                </div>
                <Button
                  aria-label={`${t('screening.retake')} ${index + 1}`}
                  onClick={() => removePhoto(index)}
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" size={18} />
                </Button>
              </article>
            ))}
          </div>
          {hasLowQuality && (
            !isPatient && <label className="screening-override">
              <input
                checked={acceptLowQuality}
                onChange={(event) => setAcceptLowQuality(event.target.checked)}
                type="checkbox"
              />
              <span>{t('screening.acceptLowQuality')}</span>
            </label>
          )}
          {errorText && <p className="screening-error" role="alert">{errorText}</p>}
          {progress > 0 && progress < 100 && (
            <progress aria-label={t('screening.uploading', { progress })} max="100" value={progress} />
          )}
          <div className="screening-actions">
            <Button onClick={() => setStep(1)} type="button" variant="outline">
              {t('screening.back')}
            </Button>
            <Button
              disabled={
                busy
                || hasLowQuality && (isPatient || !acceptLowQuality)
                || isPatient && photos.length === 0
              }
              onClick={() => void submit()}
              type="button"
            >
              {busy
                ? progress > 0
                  ? t('screening.uploading', { progress })
                  : t('screening.continue')
                : t('screening.continue')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
