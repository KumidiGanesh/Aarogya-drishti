import { useEffect, useState } from 'react';
import { Eye, EyeOff, HeartPulse } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { normalizeIndianMobile } from '../auth/indianMobile.js';
import { roleDashboardPath } from '../auth/roles.js';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import OtpCodeInput from '../components/auth/OtpCodeInput.jsx';
import Select from '../components/ui/Select.jsx';
import VoiceGuidanceToggle from '../components/VoiceGuidanceToggle.jsx';
import api from '../services/api.js';

const EMPTY_FIELDS = {
  full_name: '',
  age: '',
  gender: 'undisclosed',
  email: '',
  password: '',
  confirm_password: '',
  village_name: '',
  mandal: '',
  address: '',
  district: '',
  state: '',
  emergency_contact_number: '',
  conditions: '',
  allergies: '',
  current_medications: '',
  tobacco_use: false,
  gutkha_use: false,
};

const listValues = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);

export default function PatientPublicRegistrationPage() {
  const { t, i18n } = useTranslation();
  const { user, loading, completeRegistration } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState(() => (
    /^[6-9]\d{9}$/.test(location.state?.mobile || '')
      ? location.state.mobile
      : ''
  ));
  const [challengeId, setChallengeId] = useState('');
  const [demoMode, setDemoMode] = useState(false);
  const [demoOtp, setDemoOtp] = useState('');
  const [demoOtpCopied, setDemoOtpCopied] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!challengeId || verificationToken) return undefined;
    const timer = window.setInterval(() => {
      setSeconds((value) => Math.max(0, value - 1));
      setResendSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [challengeId, verificationToken]);

  if (!loading && user) {
    return (
      <Navigate
        replace
        to={user.role === 'patient' ? '/patient/dashboard' : roleDashboardPath[user.role] || '/'}
      />
    );
  }

  const update = (key) => (event) => {
    setFields((current) => ({ ...current, [key]: event.target.value }));
  };

  const requestOtp = async () => {
    setError('');
    setDemoMode(false);
    setDemoOtp('');
    setDemoOtpCopied(false);
    setBusy(true);
    try {
      const { data } = await api.post('/patient/send-otp', { mobile });
      const demo = data.data.delivery_mode === 'demo';
      const codeValue = demo ? data.data.demo_otp : '';
      if (demo && !/^\d{6}$/.test(codeValue || '')) {
        setError('auth.serverUnavailable');
        return;
      }
      setChallengeId(data.data.challenge_id);
      setDemoMode(demo);
      setDemoOtp(codeValue);
      setVerificationToken('');
      setCode('');
      setSeconds(data.data.expires_in);
      setResendSeconds(data.data.resend_after ?? 30);
    } catch (requestError) {
      const codeValue = requestError.response?.data?.code;
      if (codeValue === 'MOBILE_ALREADY_REGISTERED') {
        navigate('/login?type=patient', { replace: true, state: { mobile } });
        return;
      }
      setError(codeValue === 'DATABASE_UNAVAILABLE'
          ? 'auth.databaseUnavailable'
        : codeValue === 'DEMO_OTP_DISABLED'
            ? 'auth.demoOtpUnavailable'
        : codeValue === 'OTP_DELIVERY_UNAVAILABLE' || codeValue === 'OTP_DELIVERY_FAILED'
          ? 'auth.otpDeliveryUnavailable'
        : codeValue === 'OTP_RATE_LIMITED'
          ? 'auth.otpRateLimited'
          : codeValue === 'OTP_RESEND_TOO_SOON'
            ? 'auth.otpResendTooSoon'
            : !requestError.response
              ? 'auth.backendUnreachable'
            : requestError.response.status >= 500
              || requestError.response?.status === 404
            ? 'auth.serverUnavailable'
            : 'auth.invalidMobile');
    } finally {
      setBusy(false);
    }
  };

  const editMobile = () => {
    setChallengeId('');
    setDemoMode(false);
    setDemoOtp('');
    setDemoOtpCopied(false);
    setVerificationToken('');
    setCode('');
    setSeconds(0);
    setResendSeconds(0);
    setMobile('');
    setError('');
  };

  const verifyOtp = async () => {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/patient/verify-otp', {
        challenge_id: challengeId,
        code,
      });
      setVerificationToken(data.data.verification_token);
      setDemoOtp('');
      setDemoOtpCopied(false);
    } catch (requestError) {
      const codeValue = requestError.response?.data?.code;
      setError(codeValue === 'OTP_EXPIRED'
        ? 'auth.otpExpired'
        : codeValue === 'OTP_PROVIDER_UNAVAILABLE'
          ? 'auth.otpVerificationUnavailable'
        : codeValue === 'OTP_INVALID' || codeValue === 'OTP_ATTEMPTS_EXCEEDED'
          ? 'auth.otpInvalid'
          : codeValue === 'OTP_RATE_LIMITED'
            ? 'auth.otpRateLimited'
            : 'auth.serverUnavailable');
    } finally {
      setBusy(false);
    }
  };

  const copyDemoOtp = async () => {
    if (!navigator.clipboard?.writeText) {
      setError('auth.demoOtpCopyUnavailable');
      return;
    }
    try {
      await navigator.clipboard.writeText(demoOtp);
      setDemoOtpCopied(true);
    } catch {
      setError('auth.demoOtpCopyUnavailable');
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!consent) {
      setError('auth.consentRequired');
      return;
    }
    if (fields.password !== fields.confirm_password) {
      setError('auth.passwordMismatch');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/patient/register', {
        verification_token: verificationToken,
        full_name: fields.full_name.trim(),
        age: Number(fields.age),
        gender: fields.gender,
        mobile,
        email: fields.email.trim(),
        password: fields.password,
        confirm_password: fields.confirm_password,
        village_name: fields.village_name.trim(),
        mandal: fields.mandal.trim(),
        address: fields.address.trim(),
        district: fields.district.trim(),
        state: fields.state.trim(),
        emergency_contact_number: fields.emergency_contact_number,
        medical_history: {
          conditions: listValues(fields.conditions),
          allergies: listValues(fields.allergies),
          current_medications: listValues(fields.current_medications),
          tobacco_use: fields.tobacco_use,
          gutkha_use: fields.gutkha_use,
        },
        consent: true,
        preferred_language: i18n.language,
      });
      await completeRegistration(data.data);
      navigate('/patient/dashboard', { replace: true });
    } catch (requestError) {
      const codeValue = requestError.response?.data?.code;
      if (codeValue === 'MOBILE_ALREADY_REGISTERED') {
        navigate('/login?type=patient', { replace: true, state: { mobile } });
        return;
      }
      setError(codeValue === 'EMAIL_ALREADY_REGISTERED'
          ? 'auth.emailAlreadyRegistered'
          : codeValue === 'INVALID_AGE'
            ? 'auth.invalidAge'
        : codeValue === 'OTP_VERIFICATION_REQUIRED'
          ? 'auth.verifyMobileFirst'
          : codeValue === 'INVALID_DATE_OF_BIRTH'
            ? 'auth.invalidDateOfBirth'
            : requestError.response?.status >= 500 || !requestError.response
              ? 'auth.serverUnavailable'
              : 'auth.registerFailed');
    } finally {
      setBusy(false);
    }
  };

  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <main className="auth-page">
      <section aria-labelledby="register-title" className="auth-card auth-card--wide patient-public-registration">
        <div className="auth-brand">
          <span aria-hidden="true" className="brand__mark"><HeartPulse size={23} /></span>
          <div><strong>{t('brandName')}</strong><span>{t('demoNotice')}</span></div>
        </div>
        <h1 id="register-title">{t('auth.registerTitle')}</h1>
        <p className="auth-description">{t('auth.patientRegistrationDescription')}</p>
        <VoiceGuidanceToggle />
        {!challengeId && (
          <div className="auth-form">
            <div className="mobile-number-field">
              <span aria-label={t('auth.indiaCountryCode')}>+91</span>
              <Input
                autoComplete="tel-national"
                id="patient-register-mobile"
                inputMode="numeric"
                label={t('auth.mobile')}
                maxLength={16}
                onChange={(event) => setMobile(normalizeIndianMobile(event.target.value))}
                pattern="[6-9][0-9]{9}"
                required
                value={mobile}
              />
            </div>
            <Button
              className="auth-submit"
              disabled={busy || !/^[6-9]\d{9}$/.test(mobile)}
              onClick={requestOtp}
              type="button"
            >
              {busy ? t('loading') : t('auth.sendOtp')}
            </Button>
          </div>
        )}
        {challengeId && !verificationToken && (
          <div className="auth-form">
            <h2>{t('auth.enterOtpTitle')}</h2>
            {demoMode && (
              <div className="auth-hint auth-demo-otp" role="status">
                <strong>{t('auth.demoOtpMode')}</strong>
                <div className="auth-demo-otp__code">
                  <strong>{t('auth.demoOtpValue', { code: demoOtp })}</strong>
                  <Button
                    disabled={!demoOtp}
                    onClick={copyDemoOtp}
                    type="button"
                    variant="outline"
                  >
                    {t('auth.copyDemoOtp')}
                  </Button>
                </div>
                {demoOtpCopied && <span>{t('auth.demoOtpCopied')}</span>}
              </div>
            )}
            <p className="auth-hint">
              {demoMode
                ? t('auth.demoOtpPrompt', { mobile: `+91 ${mobile.slice(-4).padStart(10, '*')}` })
                : t('auth.otpSentTo', { mobile: `+91 ${mobile.slice(-4).padStart(10, '*')}` })}
            </p>
            <OtpCodeInput disabled={busy} onChange={setCode} value={code} />
            <p aria-live="polite" className="auth-hint">
              {seconds > 0 ? t('auth.otpExpiresIn', { time }) : t('auth.otpExpired')}
            </p>
            <Button disabled={busy || code.length !== 6 || seconds === 0} onClick={verifyOtp} type="button">
              {busy ? t('loading') : t('auth.verifyOtp')}
            </Button>
            <Button disabled={busy || resendSeconds > 0} onClick={requestOtp} type="button" variant="outline">
              {resendSeconds > 0
                ? t('auth.resendOtpCountdown', { time: `${Math.floor(resendSeconds / 60)}:${String(resendSeconds % 60).padStart(2, '0')}` })
                : t('auth.resendOtp')}
            </Button>
            <Button disabled={busy} onClick={editMobile} type="button" variant="outline">
              {t('auth.editMobile')}
            </Button>
          </div>
        )}
        {verificationToken && (
          <Card className="patient-registration-card patient-registration-card--public">
            <div className="patient-verified-mobile" role="status">
              <span>{t('auth.verifiedMobile')}</span>
              <strong>+91 {mobile}</strong>
              <p className="auth-success">{t('auth.mobileVerifiedSuccess')}</p>
              <Button disabled={busy} onClick={editMobile} type="button" variant="outline">
                {t('auth.editMobile')}
              </Button>
            </div>
            <form className="auth-form patient-public-form" onSubmit={submit}>
              <Input autoComplete="name" id="patient-register-name" label={t('auth.fullName')} onChange={update('full_name')} required value={fields.full_name} />
              <Input autoComplete="email" id="patient-register-email" label={t('auth.email')} maxLength={254} onChange={update('email')} required type="email" value={fields.email} />
              <Input autoComplete="off" id="patient-register-age" inputMode="numeric" label={t('patient.age')} max={120} min={1} onChange={(event) => setFields((current) => ({ ...current, age: event.target.value.replace(/\D/g, '').slice(0, 3) }))} required type="number" value={fields.age} />
              <Select id="patient-register-gender" label={t('patient.gender')} onChange={update('gender')} value={fields.gender}>
                <option value="female">{t('patient.female')}</option>
                <option value="male">{t('patient.male')}</option>
                <option value="non_binary">{t('patient.nonBinary')}</option>
                <option value="undisclosed">{t('patient.undisclosed')}</option>
              </Select>
              <Input autoComplete="address-level3" id="patient-register-village" label={t('patient.village')} onChange={update('village_name')} required value={fields.village_name} />
              <Input autoComplete="address-level2" id="patient-register-mandal" label={t('patient.mandal')} onChange={update('mandal')} required value={fields.mandal} />
              <Input autoComplete="address-level2" id="patient-register-district" label={t('patient.district')} onChange={update('district')} required value={fields.district} />
              <Input autoComplete="street-address" id="patient-register-address" label={t('auth.address')} onChange={update('address')} required value={fields.address} />
              <Input autoComplete="address-level1" id="patient-register-state" label={t('auth.state')} onChange={update('state')} required value={fields.state} />
              <div className="password-field">
                <Input autoComplete="new-password" id="patient-register-password" label={t('auth.password')} minLength={8} onChange={update('password')} required type={showPassword ? 'text' : 'password'} value={fields.password} />
                <button aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')} className="password-toggle" onClick={() => setShowPassword((shown) => !shown)} type="button">
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              <div className="password-field">
                <Input autoComplete="new-password" id="patient-register-confirm-password" label={t('auth.confirmPassword')} minLength={8} onChange={update('confirm_password')} required type={showConfirmPassword ? 'text' : 'password'} value={fields.confirm_password} />
                <button aria-label={showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')} className="password-toggle" onClick={() => setShowConfirmPassword((shown) => !shown)} type="button">
                  {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              <p className="auth-hint">{t('auth.passwordPolicy')}</p>
              <Input autoComplete="tel-national" id="patient-register-emergency" inputMode="numeric" label={t('auth.emergencyContact')} maxLength={10} onChange={(event) => setFields((current) => ({ ...current, emergency_contact_number: event.target.value.replace(/\D/g, '').slice(0, 10) }))} pattern="[6-9][0-9]{9}" required value={fields.emergency_contact_number} />
              <Input id="patient-register-conditions" label={t('auth.medicalConditions')} onChange={update('conditions')} value={fields.conditions} />
              <Input id="patient-register-allergies" label={t('auth.allergies')} onChange={update('allergies')} value={fields.allergies} />
              <Input id="patient-register-medications" label={t('auth.currentMedications')} onChange={update('current_medications')} value={fields.current_medications} />
              <label className="patient-checkbox">
                <input checked={fields.tobacco_use} onChange={(event) => setFields((current) => ({ ...current, tobacco_use: event.target.checked }))} type="checkbox" />
                <span>{t('patient.tobacco')}</span>
              </label>
              <label className="patient-checkbox">
                <input checked={fields.gutkha_use} onChange={(event) => setFields((current) => ({ ...current, gutkha_use: event.target.checked }))} type="checkbox" />
                <span>{t('patient.gutkha')}</span>
              </label>
              <label className="patient-checkbox patient-public-consent">
                <input checked={consent} onChange={(event) => setConsent(event.target.checked)} required type="checkbox" />
                <span>{t('auth.patientConsent')}</span>
              </label>
              {error && <p className="auth-error" role="alert">{t(error)}</p>}
              <Button className="auth-submit" disabled={busy}>{busy ? t('loading') : t('auth.completeRegistration')}</Button>
            </form>
          </Card>
        )}
        {error && !verificationToken && <p className="auth-error" role="alert">{t(error)}</p>}
        <p className="auth-switch">
          {t('auth.haveAccount')} <Link to="/patient/login">{t('auth.loginLink')}</Link>
        </p>
        <p className="auth-safety">{t('auth.syntheticOnly')}</p>
      </section>
    </main>
  );
}
