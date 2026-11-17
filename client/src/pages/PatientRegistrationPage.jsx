import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, ShieldCheck, Volume2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import Select from '../components/ui/Select.jsx';
import AadhaarUploadCard from '../components/patients/AadhaarUploadCard.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { symptomCatalog } from '../offline/masterData.js';
import { enqueueRegistration } from '../offline/queue.js';
import api from '../services/api.js';

const EMPTY_FORM = {
  full_name: '',
  age: '',
  date_of_birth: '',
  gender: 'undisclosed',
  mobile: '',
  village_name: '',
  gram_panchayat: '',
  district: '',
  mandal: '',
  phc_name: '',
  address: '',
  state: 'Andhra Pradesh',
  medical_history: { conditions: '', allergies: '', current_medications: '' },
  tobacco_use: false,
  tobacco_duration_months: '',
  tobacco_frequency_per_day: '',
  gutkha_use: false,
  gutkha_duration_months: '',
  gutkha_frequency_per_day: '',
  areca_nut_use: false,
  areca_nut_duration_months: '',
  areca_nut_frequency_per_day: '',
  current_symptoms: '',
};

function commaList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalNumber(value) {
  return value === '' ? undefined : Number(value);
}

function ageFromDateOfBirth(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return age >= 0 && age <= 120 ? String(age) : '';
}

export default function PatientRegistrationPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { notify } = useToast();
  const formRef = useRef(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedPatient, setSavedPatient] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [justification, setJustification] = useState('');
  const [consentError, setConsentError] = useState(false);
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const [aadhaarConsent, setAadhaarConsent] = useState(false);
  const [aadhaarDetailsConfirmed, setAadhaarDetailsConfirmed] = useState(false);
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [aadhaarNumberVisible, setAadhaarNumberVisible] = useState(false);
  const [aadhaarError, setAadhaarError] = useState('');
  const [aadhaarUploads, setAadhaarUploads] = useState({ front: null, back: null });
  const [aadhaarBusy, setAadhaarBusy] = useState(false);
  const aadhaarFrontInput = useRef(null);
  const aadhaarBackInput = useRef(null);
  const steps = 4;

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateHistory = (key, value) =>
    setForm((current) => ({
      ...current,
      medical_history: { ...current.medical_history, [key]: value },
    }));

  const normalizedPayload = (force = false, options = {}) => ({
    full_name: form.full_name,
    age: optionalNumber(form.age) ?? null,
    date_of_birth: form.date_of_birth || undefined,
    gender: form.gender,
    mobile: form.mobile,
    village_name: form.village_name,
    gram_panchayat: form.gram_panchayat,
    district: form.district,
    state: form.state,
    mandal: form.mandal,
    phc_name: form.phc_name,
    address: form.address,
    medical_history: {
      conditions: commaList(form.medical_history.conditions),
      allergies: commaList(form.medical_history.allergies),
      current_medications: commaList(form.medical_history.current_medications),
    },
    tobacco_use: form.tobacco_use,
    tobacco_duration_months: optionalNumber(form.tobacco_duration_months),
    tobacco_frequency_per_day: optionalNumber(form.tobacco_frequency_per_day),
    gutkha_use: form.gutkha_use,
    gutkha_duration_months: optionalNumber(form.gutkha_duration_months),
    gutkha_frequency_per_day: optionalNumber(form.gutkha_frequency_per_day),
    areca_nut_use: form.areca_nut_use,
    areca_nut_duration_months: optionalNumber(form.areca_nut_duration_months),
    areca_nut_frequency_per_day: optionalNumber(form.areca_nut_frequency_per_day),
    current_symptoms: commaList(form.current_symptoms),
    consent: { given: consent, language: i18n.language },
    client_uuid: clientUuid,
    ...(!options.excludeAadhaar && (aadhaarConsent || aadhaarNumber || Object.values(aadhaarUploads).some((upload) => upload?.stageId)) ? {
      ...(aadhaarNumber.replace(/\D/g, '').length === 12 ? { aadhaar_last4: aadhaarNumber.replace(/\D/g, '').slice(-4) } : {}),
      aadhaar_upload_ids: Object.values(aadhaarUploads).map((upload) => upload?.stageId).filter(Boolean),
      aadhaar_consent: { given: true, language: i18n.language },
    } : {}),
    ...(force ? { force: true, justification: justification.trim() } : {}),
  });

  const saveOffline = async (payload) => {
    try {
      await enqueueRegistration(payload);
      notify(t('patient.savedOffline'), 'success');
      navigate('/patients/sync-status');
    } catch {
      notify(t('patient.registrationError'), 'error');
    }
  };

  const submit = async (payload) => {
    setBusy(true);
    try {
      const { data } = await api.post('/patients', payload);
      setSavedPatient({
        ...data.data.patient,
        temporary_password: data.data.temporary_password,
      });
      setDuplicate(null);
      setConsentError(false);
    } catch (error) {
      if (error.response?.status === 409 && error.response.data.code === 'PATIENT_DUPLICATE') {
        setDuplicate({
          candidates: error.response.data.errors?.[0]?.candidates || [],
          payload,
        });
      } else if (
        error.response?.status === 409
        && ['PATIENT_ACCOUNT_EXISTS', 'PATIENT_ACCOUNT_ALREADY_LINKED'].includes(error.response.data.code)
      ) {
        notify(t('patient.accountConflict'), 'error');
      } else if (!error.response) {
        const offlinePayload = { ...payload };
        const hadAadhaarContent = Boolean(offlinePayload.aadhaar_last4 || offlinePayload.aadhaar_upload_ids?.length);
        delete offlinePayload.aadhaar_last4;
        delete offlinePayload.aadhaar_upload_ids;
        delete offlinePayload.aadhaar_consent;
        if (hadAadhaarContent) notify(t('aadhaar.offlineDocuments'), 'warning');
        await saveOffline(offlinePayload);
      } else if (error.response.status === 422 && error.response.data.code === 'CONSENT_REQUIRED') {
        setConsentError(true);
      } else if (error.response?.data?.code === 'AADHAAR_UPLOAD_EXPIRED') {
        setAadhaarError('aadhaar.uploadExpired');
      } else if (error.response?.data?.code === 'AADHAAR_NUMBER_MISMATCH') {
        setAadhaarError('aadhaar.numberMismatch');
      } else if (error.response?.data?.code === 'AADHAAR_CONSENT_REQUIRED') {
        setAadhaarError('aadhaar.consentRequired');
      } else {
        notify(t('patient.registrationError'), 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const removeAadhaarSide = async (side) => {
    const previous = aadhaarUploads[side];
    if (previous?.stageId) {
      try { await api.delete(`/patients/aadhaar/uploads/${previous.stageId}`); } catch { /* Staged uploads expire and are purged automatically. */ }
    }
    if (previous?.preview?.startsWith('blob:')) URL.revokeObjectURL(previous.preview);
    setAadhaarUploads((current) => ({ ...current, [side]: null }));
    setAadhaarDetailsConfirmed(false);
    setAadhaarError('');
  };

  const uploadAadhaarSide = async (side, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const extensionAllowed = /\.(jpe?g|png|pdf)$/i.test(file.name);
    const mimeAllowed = ['image/jpeg', 'image/png', 'application/pdf'].includes(file.type);
    if ((!mimeAllowed && !extensionAllowed) || file.size > 5 * 1024 * 1024) {
      setAadhaarError('aadhaar.uploadError');
      return;
    }
    if (!aadhaarConsent) {
      setAadhaarError('aadhaar.consentRequired');
      return;
    }
    const existing = aadhaarUploads[side];
    if (existing?.stageId) {
      try { await api.delete(`/patients/aadhaar/uploads/${existing.stageId}`); } catch { /* Staged uploads expire and are purged automatically. */ }
    }
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setAadhaarError('');
    setAadhaarBusy(true);
    setAadhaarDetailsConfirmed(false);
    setAadhaarUploads((current) => ({ ...current, [side]: { name: file.name, preview: previewUrl, status: 'uploading', progress: 0 } }));
    const payload = new FormData();
    payload.append('file', file);
    payload.append('side', side);
    payload.append('consent', 'true');
    payload.append('language', i18n.language.split('-')[0]);
    try {
      const { data } = await api.post('/patients/aadhaar/extract', payload, {
        timeout: 180000,
        onUploadProgress: (progress) => {
          const percentage = progress.total ? Math.round((progress.loaded * 100) / progress.total) : 0;
          setAadhaarUploads((current) => current[side] ? { ...current, [side]: { ...current[side], progress: percentage, status: percentage < 100 ? 'uploading' : 'processing' } } : current);
        },
      });
      const result = data.data;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setAadhaarUploads((current) => ({
        ...current,
        [side]: {
          name: file.name,
          preview: result.redacted_preview,
          stageId: result.stage_id,
          status: result.document_stored ? 'stored' : 'failed',
          error: result.document_stored ? '' : (result.warning_code === 'AADHAAR_REDACTION_UNCONFIRMED' ? 'aadhaar.redactionFailed' : 'aadhaar.extractionFailed'),
        },
      }));
      const extracted = result.fields || {};
      setForm((current) => ({
        ...current,
        ...(extracted.full_name ? { full_name: extracted.full_name } : {}),
        ...(extracted.date_of_birth ? { date_of_birth: extracted.date_of_birth, age: ageFromDateOfBirth(extracted.date_of_birth) } : {}),
        ...(extracted.gender === 'female' || extracted.gender === 'male' ? { gender: extracted.gender } : {}),
        ...(extracted.address ? { address: extracted.address } : {}),
      }));
        setAadhaarNumber((current) => extracted.aadhaar_number || current);
    } catch {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setAadhaarUploads((current) => ({ ...current, [side]: { name: file.name, preview: null, status: 'failed', error: 'aadhaar.uploadError' } }));
    } finally {
      setAadhaarBusy(false);
    }
  };

  const changeAadhaarConsent = (granted) => {
    setAadhaarConsent(granted);
    setAadhaarError('');
    if (!granted) {
      for (const upload of Object.values(aadhaarUploads)) {
        if (upload?.stageId) void api.delete(`/patients/aadhaar/uploads/${upload.stageId}`).catch(() => {});
        if (upload?.preview?.startsWith('blob:')) URL.revokeObjectURL(upload.preview);
      }
      setAadhaarUploads({ front: null, back: null });
      setAadhaarNumber('');
      setAadhaarDetailsConfirmed(false);
    }
  };

  const nextStep = () => {
    if (!formRef.current?.reportValidity()) return;
    setStep((current) => Math.min(steps - 1, current + 1));
  };

  const submitForm = (event) => {
    event.preventDefault();
    if (!consent) {
      setConsentError(true);
      return;
    }
    const aadhaarDigits = aadhaarNumber.replace(/\D/g, '');
    const hasAadhaarData = Boolean(aadhaarDigits || Object.values(aadhaarUploads).some((upload) => upload?.stageId));
    if (aadhaarDigits && aadhaarDigits.length !== 12) {
      setAadhaarError('aadhaar.numberInvalid');
      return;
    }
    if (hasAadhaarData && !aadhaarConsent) {
      setAadhaarError('aadhaar.consentRequired');
      return;
    }
    if (hasAadhaarData && !aadhaarDetailsConfirmed) {
      setAadhaarError('aadhaar.confirmationRequired');
      return;
    }
    setAadhaarError('');
    setConsentError(false);
    if (!navigator.onLine) {
      if (hasAadhaarData) notify(t('aadhaar.offlineDocuments'), 'warning');
      void saveOffline(normalizedPayload(false, { excludeAadhaar: true }));
      return;
    }
    void submit(normalizedPayload());
  };

  const playConsent = () => {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(t('patient.consentText'));
    utterance.lang = { te: 'te-IN', hi: 'hi-IN', or: 'or-IN' }[i18n.language] || 'en-IN';
    window.speechSynthesis.speak(utterance);
  };

  const createAnyway = () => {
    if (justification.trim().length < 10) {
      notify(t('patient.createReasonRequired'), 'error');
      return;
    }
    void submit({
      ...duplicate.payload,
      force: true,
      justification: justification.trim(),
    });
  };

  const clearForm = () => {
    for (const upload of Object.values(aadhaarUploads)) {
      if (upload?.stageId) void api.delete(`/patients/aadhaar/uploads/${upload.stageId}`).catch(() => {});
      if (upload?.preview?.startsWith('blob:')) URL.revokeObjectURL(upload.preview);
    }
    setForm(EMPTY_FORM);
    setStep(0);
    setConsent(false);
    setAadhaarConsent(false);
    setAadhaarDetailsConfirmed(false);
    setAadhaarNumber('');
    setAadhaarNumberVisible(false);
    setAadhaarUploads({ front: null, back: null });
    setAadhaarError('');
    setSavedPatient(null);
    setClientUuid(crypto.randomUUID());
  };

  const exposureField = (field, labelKey) => (
    <div className="patient-exposure" key={field}>
      <label className="patient-checkbox">
        <input
          checked={form[`${field}_use`]}
          onChange={(event) => update(`${field}_use`, event.target.checked)}
          type="checkbox"
        />
        <span>{t(`patient.${labelKey}`)}</span>
      </label>
      {form[`${field}_use`] && (
        <div className="patient-form-grid">
          <Input
            id={`${field}-duration`}
            label={t('patient.durationMonths')}
            min="0"
            onChange={(event) => update(`${field}_duration_months`, event.target.value)}
            type="number"
            value={form[`${field}_duration_months`]}
          />
          <Input
            id={`${field}-frequency`}
            label={t('patient.frequencyPerDay')}
            min="0"
            onChange={(event) => update(`${field}_frequency_per_day`, event.target.value)}
            type="number"
            value={form[`${field}_frequency_per_day`]}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="patient-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('patient.management')}</p>
          <h1>{t('patient.registrationTitle')}</h1>
          <p className="page-heading__description">{t('patient.registrationDescription')}</p>
        </div>
      </div>

      {savedPatient ? (
        <Card className="patient-success">
          <h2>{t('patient.registrationSaved', { code: savedPatient.patient_code })}</h2>
          {savedPatient.temporary_password && (
            <div className="patient-temporary-credentials" role="alert">
              <h3>{t('patient.temporaryPasswordTitle')}</h3>
              <p>{t('patient.temporaryPasswordInstructions')}</p>
              <output>{savedPatient.temporary_password}</output>
            </div>
          )}
          <div className="patient-actions">
            <Button onClick={() => navigate(`/patients/${savedPatient.id}`)} type="button">
              {t('patient.profile')}
            </Button>
            <Button onClick={clearForm} type="button" variant="outline">
              {t('patient.register')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="patient-registration-card">
          <p className="auth-hint">{t('phase10.patientDictationNotice')}</p>
          <div aria-live="polite" className="patient-step-label">
            {t('patient.step', { current: step + 1, total: steps })}
          </div>
          <form onSubmit={submitForm} ref={formRef}>
            {step === 0 && (
              <div className="patient-form-stack">
                <div className="patient-form-grid">
                <Input
                  autoComplete="name"
                  id="patient-full-name"
                  label={t('patient.fullName')}
                  maxLength="160"
                  onChange={(event) => update('full_name', event.target.value)}
                  onVoiceTranscript={(value) => update('full_name', value)}
                  required
                  value={form.full_name}
                  voiceLanguage={i18n.language}
                />
                <Input
                  id="patient-age"
                  label={t('patient.age')}
                  max="120"
                  min="0"
                  onChange={(event) => setForm((current) => ({ ...current, age: event.target.value, date_of_birth: '' }))}
                  type="number"
                  value={form.age}
                />
                <Select
                  id="patient-gender"
                  label={t('patient.gender')}
                  onChange={(event) => update('gender', event.target.value)}
                  value={form.gender}
                >
                  <option value="female">{t('patient.female')}</option>
                  <option value="male">{t('patient.male')}</option>
                  <option value="non_binary">{t('patient.nonBinary')}</option>
                  <option value="undisclosed">{t('patient.undisclosed')}</option>
                </Select>
                <Input
                  autoComplete="tel-national"
                  id="patient-mobile"
                  label={t('patient.mobile')}
                  maxLength="10"
                  onChange={(event) => update('mobile', event.target.value)}
                  pattern="[6-9][0-9]{9}"
                  required
                  value={form.mobile}
                />
                </div>

                <section aria-labelledby="aadhaar-section-title" className="aadhaar-section">
                  <div className="aadhaar-section__heading">
                    <span className="aadhaar-section__icon"><ShieldCheck aria-hidden="true" size={21} /></span>
                    <div><h2 id="aadhaar-section-title">{t('aadhaar.title')}</h2><p>{t('aadhaar.optional')}</p></div>
                  </div>
                  <p className="aadhaar-section__privacy">{t('aadhaar.privacy')}</p>
                  <label className="patient-checkbox patient-consent-check aadhaar-section__consent">
                    <input checked={aadhaarConsent} onChange={(event) => changeAadhaarConsent(event.target.checked)} type="checkbox" />
                    <span>{t('aadhaar.consent')}</span>
                  </label>
                  <div className="aadhaar-upload-grid">
                    <AadhaarUploadCard disabled={!aadhaarConsent || aadhaarBusy} inputRef={aadhaarFrontInput} onFile={(event) => void uploadAadhaarSide('front', event)} onRemove={() => void removeAadhaarSide('front')} side="front" upload={aadhaarUploads.front} />
                    <AadhaarUploadCard disabled={!aadhaarConsent || aadhaarBusy} inputRef={aadhaarBackInput} onFile={(event) => void uploadAadhaarSide('back', event)} onRemove={() => void removeAadhaarSide('back')} side="back" upload={aadhaarUploads.back} />
                  </div>
                  {aadhaarConsent && (
                    <div className="aadhaar-details-panel">
                      <div><h3>{t('aadhaar.detailsTitle')}</h3><p>{t('aadhaar.review')}</p></div>
                      <div className="patient-form-grid">
                        <Input autoComplete="name" id="aadhaar-patient-name" label={t('aadhaar.fullName')} maxLength="160" onChange={(event) => update('full_name', event.target.value)} value={form.full_name} />
                        <Input id="aadhaar-patient-dob" label={t('aadhaar.dateOfBirth')} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setForm((current) => ({ ...current, date_of_birth: event.target.value, age: ageFromDateOfBirth(event.target.value) }))} type="date" value={form.date_of_birth} />
                        <Select id="aadhaar-patient-gender" label={t('aadhaar.gender')} onChange={(event) => update('gender', event.target.value)} value={form.gender}>
                          <option value="female">{t('patient.female')}</option><option value="male">{t('patient.male')}</option><option value="non_binary">{t('patient.nonBinary')}</option><option value="undisclosed">{t('patient.undisclosed')}</option>
                        </Select>
                        <Input id="aadhaar-patient-address" label={t('aadhaar.address')} maxLength="500" onChange={(event) => update('address', event.target.value)} value={form.address} />
                        <label className="aadhaar-number-field" htmlFor="aadhaar-patient-number"><span>{t('aadhaar.aadhaarNumber')}</span><div><input autoComplete="off" id="aadhaar-patient-number" inputMode="numeric" maxLength="14" onChange={(event) => setAadhaarNumber(event.target.value)} type={aadhaarNumberVisible ? 'text' : 'password'} value={aadhaarNumber} /><button aria-label={t(aadhaarNumberVisible ? 'aadhaar.hideNumber' : 'aadhaar.showNumber')} onClick={() => setAadhaarNumberVisible((visible) => !visible)} type="button">{aadhaarNumberVisible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}</button></div></label>
                      </div>
                      {(aadhaarNumber || Object.values(aadhaarUploads).some((upload) => upload?.stageId)) && (
                        <label className="patient-checkbox patient-consent-check aadhaar-section__confirm"><input checked={aadhaarDetailsConfirmed} onChange={(event) => setAadhaarDetailsConfirmed(event.target.checked)} type="checkbox" /><span>{t('aadhaar.confirmDetails')}</span></label>
                      )}
                      <p className="aadhaar-section__status"><ShieldCheck aria-hidden="true" size={15} />{t('aadhaar.verifiedDetails')}</p>
                    </div>
                  )}
                  {aadhaarError && <p className="field-error" role="alert">{t(aadhaarError)}</p>}
                </section>
              </div>
            )}

            {step === 1 && (
              <div className="patient-form-grid">
                <Input
                  autoComplete="address-level2"
                  id="patient-village"
                  label={t('patient.village')}
                  onChange={(event) => update('village_name', event.target.value)}
                  onVoiceTranscript={(value) => update('village_name', value)}
                  required
                  value={form.village_name}
                  voiceLanguage={i18n.language}
                />
                <Input
                  id="patient-gram-panchayat"
                  label={t('patient.gramPanchayat')}
                  maxLength="120"
                  onChange={(event) => update('gram_panchayat', event.target.value)}
                  onVoiceTranscript={(value) => update('gram_panchayat', value)}
                  value={form.gram_panchayat}
                  voiceLanguage={i18n.language}
                />
                <Input
                  autoComplete="address-level1"
                  id="patient-district"
                  label={t('patient.district')}
                  onChange={(event) => update('district', event.target.value)}
                  onVoiceTranscript={(value) => update('district', value)}
                  required
                  value={form.district}
                  voiceLanguage={i18n.language}
                />
                <Input
                  id="patient-mandal"
                  label={t('patient.mandal')}
                  onChange={(event) => update('mandal', event.target.value)}
                  onVoiceTranscript={(value) => update('mandal', value)}
                  required
                  value={form.mandal}
                  voiceLanguage={i18n.language}
                />
                <Input
                  id="patient-phc"
                  label={t('patient.phc')}
                  onChange={(event) => update('phc_name', event.target.value)}
                  onVoiceTranscript={(value) => update('phc_name', value)}
                  required
                  value={form.phc_name}
                  voiceLanguage={i18n.language}
                />
                <Input
                  id="patient-state"
                  label={t('aadhaar.state')}
                  maxLength="100"
                  onChange={(event) => update('state', event.target.value)}
                  value={form.state}
                />
                <Input
                  autoComplete="street-address"
                  id="patient-address"
                  label={t('patient.address')}
                  maxLength="500"
                  onChange={(event) => update('address', event.target.value)}
                  onVoiceTranscript={(value) => update('address', value)}
                  value={form.address}
                  voiceLanguage={i18n.language}
                />
              </div>
            )}

            {step === 2 && (
              <div className="patient-form-stack">
                <h2>{t('patient.medicalHistory')}</h2>
                <div className="patient-form-grid">
                  <Input
                    id="patient-conditions"
                    label={t('patient.conditions')}
                    onChange={(event) => updateHistory('conditions', event.target.value)}
                    onVoiceTranscript={(value) => updateHistory('conditions', value)}
                    value={form.medical_history.conditions}
                    voiceLanguage={i18n.language}
                  />
                  <Input
                    id="patient-allergies"
                    label={t('patient.allergies')}
                    onChange={(event) => updateHistory('allergies', event.target.value)}
                    onVoiceTranscript={(value) => updateHistory('allergies', value)}
                    value={form.medical_history.allergies}
                    voiceLanguage={i18n.language}
                  />
                  <Input
                    id="patient-medications"
                    label={t('patient.medications')}
                    onChange={(event) => updateHistory('current_medications', event.target.value)}
                    onVoiceTranscript={(value) => updateHistory('current_medications', value)}
                    value={form.medical_history.current_medications}
                    voiceLanguage={i18n.language}
                  />
                </div>
                {exposureField('tobacco', 'tobacco')}
                {exposureField('gutkha', 'gutkha')}
                {exposureField('areca_nut', 'areca')}
                <Input
                  id="patient-symptoms"
                  label={t('patient.symptoms')}
                  list="patient-symptom-catalog"
                  onChange={(event) => update('current_symptoms', event.target.value)}
                  onVoiceTranscript={(value) => update('current_symptoms', value)}
                  value={form.current_symptoms}
                  voiceLanguage={i18n.language}
                />
                <datalist id="patient-symptom-catalog">
                  {symptomCatalog.map((symptom) => (
                    <option key={symptom} value={symptom} />
                  ))}
                </datalist>
              </div>
            )}

            {step === 3 && (
              <div className="patient-consent-panel">
                <h2>{t('patient.consentTitle')}</h2>
                <p>{t('patient.consentText')}</p>
                <p className="auth-hint">{t('medicalTranslationNotice')}</p>
                <Button onClick={playConsent} type="button" variant="outline">
                  <Volume2 aria-hidden="true" size={18} />
                  {t('patient.readConsent')}
                </Button>
                <label className="patient-checkbox patient-consent-check">
                  <input
                    checked={consent}
                    onChange={(event) => {
                      setConsent(event.target.checked);
                      setConsentError(false);
                    }}
                    type="checkbox"
                  />
                  <span>{t('patient.consentGiven')}</span>
                </label>
                {consentError && (
                  <p className="field-error" role="alert">
                    {t('patient.consentRequired')}
                  </p>
                )}
              </div>
            )}

            <div className="patient-form-actions">
              {step > 0 && (
                <Button
                  onClick={() => setStep((current) => current - 1)}
                  type="button"
                  variant="outline"
                >
                  <ArrowLeft aria-hidden="true" size={18} />
                  {t('patient.back')}
                </Button>
              )}
              {step < steps - 1 ? (
                <Button className="patient-next" onClick={nextStep} type="button">
                  {t('patient.next')}
                  <ArrowRight aria-hidden="true" size={18} />
                </Button>
              ) : (
                <Button className="patient-next patient-save-registration" disabled={busy || aadhaarBusy} type="submit">
                  {t('aadhaar.saveRegistration')}
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      <Modal
        onClose={() => {
          setDuplicate(null);
          setJustification('');
        }}
        open={Boolean(duplicate)}
        title={t('patient.duplicateTitle')}
      >
        <div className="patient-form-stack">
          <p>{t('patient.duplicateMessage')}</p>
          {(duplicate?.candidates || []).map((candidate) => (
            <div className="patient-duplicate-candidate" key={candidate.id}>
              <strong>{candidate.patient_code}</strong>
              <span>{candidate.full_name}</span>
              <span>{candidate.village_name || candidate.district}</span>
              <Button
                onClick={() => navigate(`/patients/${candidate.id}`)}
                type="button"
                variant="outline"
              >
                {t('patient.useExisting')}
              </Button>
            </div>
          ))}
          <Input
            id="patient-duplicate-reason"
            label={t('patient.justification')}
            maxLength="500"
            minLength="10"
            onChange={(event) => setJustification(event.target.value)}
            onVoiceTranscript={setJustification}
            required
            value={justification}
            voiceLanguage={i18n.language}
          />
          <div className="patient-actions">
            <Button onClick={() => void createAnyway()} type="button">
              {t('patient.createAnyway')}
            </Button>
            <Button
              onClick={() => {
                setDuplicate(null);
                setJustification('');
              }}
              type="button"
              variant="outline"
            >
              {t('patient.cancel')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
