import { useEffect, useState } from 'react';
import { HeartPulse, LockKeyhole } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { normalizeIndianMobile } from '../auth/indianMobile.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import OtpCodeInput from '../components/auth/OtpCodeInput.jsx';
import VoiceGuidanceToggle from '../components/VoiceGuidanceToggle.jsx';
import api from '../services/api.js';

function countdown(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function PatientLoginPage() {
  const { t } = useTranslation();
  const { user, loading, loginPatient } = useAuth();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryStage, setRecoveryStage] = useState('request');
  const [recoveryMobile, setRecoveryMobile] = useState('');
  const [recoveryChallenge, setRecoveryChallenge] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [recoveryDemoMode, setRecoveryDemoMode] = useState(false);
  const [recoveryDemoOtp, setRecoveryDemoOtp] = useState('');
  const [recoveryDemoOtpCopied, setRecoveryDemoOtpCopied] = useState(false);
  const [recoverySeconds, setRecoverySeconds] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  useEffect(() => {
    if (!recoveryChallenge || recoveryToken) return undefined;
    const timer = window.setInterval(() => {
      setRecoverySeconds((value) => Math.max(0, value - 1));
      setResendSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recoveryChallenge, recoveryToken]);

  if (!loading && user) {
    return <Navigate replace to={user.role === 'patient' ? '/patient/dashboard' : '/'} />;
  }

  const submitLogin = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await loginPatient(mobile, password);
      navigate('/patient/dashboard', { replace: true });
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setError(code === 'LOGIN_RATE_LIMITED'
        ? 'auth.rateLimited'
        : !requestError.response || requestError.response.status >= 500
          ? 'auth.serverUnavailable'
          : 'auth.loginFailed');
    } finally {
      setBusy(false);
    }
  };

  const openRecovery = () => {
    setRecoveryMobile(mobile);
    setRecoveryStage('request');
    setRecoveryChallenge('');
    setRecoveryCode('');
    setRecoveryToken('');
    setRecoveryDemoMode(false);
    setRecoveryDemoOtp('');
    setRecoveryDemoOtpCopied(false);
    setRecoverySeconds(0);
    setResendSeconds(0);
    setNewPassword('');
    setConfirmPassword('');
    setRecoveryError('');
    setRecoveryOpen(true);
  };

  const requestRecoveryCode = async (event) => {
    event.preventDefault();
    setRecoveryError('');
    setRecoveryBusy(true);
    setRecoveryDemoMode(false);
    setRecoveryDemoOtp('');
    setRecoveryDemoOtpCopied(false);
    try {
      const { data } = await api.post('/patient/password-reset/send-otp', {
        mobile: recoveryMobile,
      });
      const demo = data.data.delivery_mode === 'demo';
      const demoOtp = demo ? data.data.demo_otp : '';
      if (demo && !/^\d{6}$/.test(demoOtp || '')) {
        setRecoveryError('auth.serverUnavailable');
        return;
      }
      setRecoveryChallenge(data.data.challenge_id);
      setRecoveryCode('');
      setRecoverySeconds(data.data.expires_in);
      setResendSeconds(data.data.resend_after ?? 30);
      setRecoveryDemoMode(demo);
      setRecoveryDemoOtp(demoOtp);
      setRecoveryStage('verify');
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setRecoveryError(code === 'PASSWORD_RESET_UNAVAILABLE'
        ? 'auth.recoveryUnavailable'
        : code === 'OTP_RATE_LIMITED'
          ? 'auth.otpRateLimited'
          : code === 'OTP_RESEND_TOO_SOON'
            ? 'auth.otpResendTooSoon'
            : code === 'OTP_DELIVERY_FAILED' || code === 'OTP_DELIVERY_UNAVAILABLE'
              ? 'auth.otpDeliveryUnavailable'
              : !requestError.response || requestError.response.status >= 500
                ? 'auth.serverUnavailable'
                : 'auth.invalidMobile');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const verifyRecoveryCode = async (event) => {
    event.preventDefault();
    setRecoveryError('');
    setRecoveryBusy(true);
    try {
      const { data } = await api.post('/patient/password-reset/verify-otp', {
        challenge_id: recoveryChallenge,
        code: recoveryCode,
      });
      setRecoveryToken(data.data.verification_token);
      setRecoveryDemoOtp('');
      setRecoveryDemoOtpCopied(false);
      setRecoveryStage('reset');
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setRecoveryError(code === 'OTP_EXPIRED'
        ? 'auth.otpExpired'
        : code === 'OTP_INVALID' || code === 'OTP_ATTEMPTS_EXCEEDED'
          ? 'auth.otpInvalid'
          : code === 'OTP_RATE_LIMITED'
            ? 'auth.otpRateLimited'
            : !requestError.response || requestError.response.status >= 500
              ? 'auth.serverUnavailable'
              : 'auth.loginFailed');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const copyRecoveryDemoOtp = async () => {
    if (!navigator.clipboard?.writeText) {
      setRecoveryError('auth.demoOtpCopyUnavailable');
      return;
    }
    try {
      await navigator.clipboard.writeText(recoveryDemoOtp);
      setRecoveryDemoOtpCopied(true);
    } catch {
      setRecoveryError('auth.demoOtpCopyUnavailable');
    }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    setRecoveryError('');
    if (newPassword !== confirmPassword) {
      setRecoveryError('auth.passwordMismatch');
      return;
    }
    setRecoveryBusy(true);
    try {
      await api.post('/patient/password-reset', {
        mobile: recoveryMobile,
        verification_token: recoveryToken,
        password: newPassword,
        confirm: confirmPassword,
      });
      setRecoveryStage('complete');
      setNewPassword('');
      setConfirmPassword('');
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setRecoveryError(code === 'OTP_VERIFICATION_REQUIRED'
        ? 'auth.otpInvalid'
        : code === 'PASSWORD_RESET_UNAVAILABLE'
          ? 'auth.recoveryUnavailable'
          : requestError.response?.status === 422 || requestError.response?.status === 400
            ? 'auth.passwordMismatch'
            : !requestError.response || requestError.response.status >= 500
              ? 'auth.serverUnavailable'
              : 'auth.recoveryUnavailable');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const recoverySubmit = recoveryStage === 'request'
    ? requestRecoveryCode
    : recoveryStage === 'verify'
      ? verifyRecoveryCode
      : resetPassword;

  return (
    <main className="auth-page">
      <section aria-labelledby="patient-login-title" className="auth-card auth-card--wide">
        <div className="auth-brand">
          <span aria-hidden="true" className="brand__mark"><HeartPulse size={23} /></span>
          <div><strong>{t('brandName')}</strong><span>ITDA PADERU</span></div>
        </div>
        <h1 id="patient-login-title">{t('auth.patientLogin')}</h1>
        <p className="auth-description">{t('auth.patientPasswordLoginDescription')}</p>
        <VoiceGuidanceToggle />
        <form className="auth-form" onSubmit={submitLogin}>
          <div className="mobile-number-field">
            <span aria-label={t('auth.indiaCountryCode')}>+91</span>
            <Input
              autoComplete="tel-national"
              id="patient-login-mobile"
              inputMode="numeric"
              label={t('auth.mobile')}
              maxLength={16}
              onChange={(event) => setMobile(normalizeIndianMobile(event.target.value))}
              pattern="[6-9][0-9]{9}"
              required
              value={mobile}
            />
          </div>
          <Input
            autoComplete="current-password"
            id="patient-login-password"
            icon={LockKeyhole}
            label={t('auth.password')}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          {error && <p className="auth-error" role="alert">{t(error)}</p>}
          <Button className="auth-submit" disabled={busy || !/^[6-9]\d{9}$/.test(mobile)}>
            {busy ? t('loading') : t('auth.login')}
          </Button>
        </form>
        <button className="auth-forgot-link" onClick={openRecovery} type="button">
          {t('auth.forgotPassword')}
        </button>
        <p className="auth-switch">
          {t('auth.noAccount')} <Link to="/patient/register">{t('auth.createPatientAccount')}</Link>
        </p>
        <p className="auth-switch">
          <Link to="/login?type=patient">{t('auth.patientOtpLoginLink')}</Link>
        </p>
        <p className="auth-safety">{t('auth.syntheticOnly')}</p>
      </section>

      <Modal
        onClose={() => setRecoveryOpen(false)}
        open={recoveryOpen}
        title={t('auth.forgotPassword')}
      >
        {recoveryStage === 'complete' ? (
          <div>
            <p className="auth-success" role="status">{t('auth.patientPasswordResetSuccess')}</p>
            <Button onClick={() => setRecoveryOpen(false)} type="button">{t('auth.login')}</Button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={recoverySubmit}>
            {recoveryStage === 'request' && (
              <>
                <p>{t('auth.patientRecoveryDescription')}</p>
                <div className="mobile-number-field">
                  <span aria-label={t('auth.indiaCountryCode')}>+91</span>
                  <Input
                    autoComplete="tel-national"
                    id="patient-recovery-mobile"
                    inputMode="numeric"
                    label={t('auth.mobile')}
                    maxLength={16}
                    onChange={(event) => setRecoveryMobile(normalizeIndianMobile(event.target.value))}
                    pattern="[6-9][0-9]{9}"
                    required
                    value={recoveryMobile}
                  />
                </div>
              </>
            )}
            {recoveryStage === 'verify' && (
              <>
                {recoveryDemoMode && (
                  <div className="auth-hint auth-demo-otp" role="status">
                    <strong>{t('auth.demoOtpMode')}</strong>
                    <div className="auth-demo-otp__code">
                      <strong>{t('auth.demoOtpValue', { code: recoveryDemoOtp })}</strong>
                      <Button
                        disabled={!recoveryDemoOtp}
                        onClick={copyRecoveryDemoOtp}
                        type="button"
                        variant="outline"
                      >
                        {t('auth.copyDemoOtp')}
                      </Button>
                    </div>
                    {recoveryDemoOtpCopied && <span>{t('auth.demoOtpCopied')}</span>}
                  </div>
                )}
                <p>{t('auth.otpSentTo', { mobile: `+91 ${recoveryMobile.slice(-4).padStart(10, '*')}` })}</p>
                <OtpCodeInput disabled={recoveryBusy} onChange={setRecoveryCode} value={recoveryCode} />
                <p aria-live="polite" className="auth-hint">
                  {recoverySeconds > 0
                    ? t('auth.otpExpiresIn', { time: countdown(recoverySeconds) })
                    : t('auth.otpExpired')}
                </p>
                <Button
                  disabled={recoveryBusy || resendSeconds > 0}
                  onClick={requestRecoveryCode}
                  type="button"
                  variant="outline"
                >
                  {resendSeconds > 0
                    ? t('auth.resendOtpCountdown', { time: countdown(resendSeconds) })
                    : t('auth.resendOtp')}
                </Button>
              </>
            )}
            {recoveryStage === 'reset' && (
              <>
                <Input
                  autoComplete="new-password"
                  id="patient-recovery-password"
                  label={t('auth.newPassword')}
                  minLength={8}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  type="password"
                  value={newPassword}
                />
                <Input
                  autoComplete="new-password"
                  id="patient-recovery-confirm"
                  label={t('auth.confirmPassword')}
                  minLength={8}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  type="password"
                  value={confirmPassword}
                />
                <p className="auth-hint">{t('auth.passwordPolicy')}</p>
              </>
            )}
            {recoveryError && <p className="auth-error" role="alert">{t(recoveryError)}</p>}
            <Button disabled={
              recoveryBusy
              || (recoveryStage === 'verify' && (!recoveryCode || recoverySeconds === 0))
            }>
              {recoveryBusy
                ? t('loading')
                : t(recoveryStage === 'request'
                  ? 'auth.sendOtp'
                  : recoveryStage === 'verify'
                    ? 'auth.verifyOtp'
                    : 'auth.resetPassword')}
            </Button>
          </form>
        )}
      </Modal>
    </main>
  );
}
