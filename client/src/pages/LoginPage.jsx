import { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  HeartPulse,
  Mail,
  LockKeyhole,
  ArrowRight,
  ShieldCheck,
  Stethoscope,
  Users,
  UserRound,
} from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { normalizeIndianMobile } from '../auth/indianMobile.js';
import { roleDashboardPath } from '../auth/roles.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import VoiceGuidanceToggle from '../components/VoiceGuidanceToggle.jsx';
import OtpCodeInput from '../components/auth/OtpCodeInput.jsx';
import api from '../services/api.js';

const loginOptions = [
  {
    id: 'patient',
    icon: UserRound,
    labelKey: 'auth.patientLogin',
    descriptionKey: 'auth.patientLoginDescription',
  },
  {
    id: 'doctor',
    icon: Stethoscope,
    labelKey: 'auth.doctorLogin',
    descriptionKey: 'auth.doctorLoginDescription',
  },
  {
    id: 'admin',
    icon: ShieldCheck,
    labelKey: 'auth.adminLogin',
    descriptionKey: 'auth.adminLoginDescription',
  },
];

const patientProfileErrorKeys = {
  PATIENT_ACCOUNT_AMBIGUOUS: 'auth.patientAccountAmbiguous',
  PATIENT_ACCOUNT_UNAVAILABLE: 'auth.patientAccountUnavailable',
  PATIENT_ACCOUNT_INACTIVE: 'auth.patientAccountInactive',
  PATIENT_PROFILE_AMBIGUOUS: 'auth.patientProfileAmbiguous',
  PATIENT_PROFILE_INCOMPLETE: 'auth.patientProfileIncomplete',
  PATIENT_PROFILE_LINK_CONFLICT: 'auth.patientProfileLinkConflict',
};

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, loading, login, loginWithOtp } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const requestedLoginType = new URLSearchParams(location.search).get('type');
  const patientOtpState = location.pathname === '/patient/verify-otp'
    ? location.state
    : null;
  const isPatientOtpRoute = location.pathname === '/patient/verify-otp';
  const isAdminReturn = (
    location.state?.from?.pathname?.startsWith('/admin/administrators')
    || location.state?.from?.pathname === '/admin-registration'
  );
  const [identifier, setIdentifier] = useState(() => patientOtpState?.mobile || location.state?.mobile || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const [loginType, setLoginType] = useState(() => (
    isPatientOtpRoute
      ? 'patient'
      : isAdminReturn
      ? 'admin'
      : ['patient', 'doctor', 'admin'].includes(requestedLoginType)
        ? requestedLoginType
        : 'doctor'
  ));
  const [showRecoveryHelp, setShowRecoveryHelp] = useState(false);
  const [recoveryStage, setRecoveryStage] = useState('request');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryChallenge, setRecoveryChallenge] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirm, setRecoveryConfirm] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoverySuccess, setRecoverySuccess] = useState(false);
  const [otpChallenge, setOtpChallenge] = useState(() => patientOtpState?.challengeId || null);
  const [demoMode, setDemoMode] = useState(() => patientOtpState?.demoMode || false);
  const [demoOtp, setDemoOtp] = useState(() => patientOtpState?.demoOtp || '');
  const [demoOtpCopied, setDemoOtpCopied] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSeconds, setOtpSeconds] = useState(() => (
    patientOtpState?.expiresAt
      ? Math.max(0, Math.ceil((patientOtpState.expiresAt - Date.now()) / 1000))
      : 0
  ));
  const [resendSeconds, setResendSeconds] = useState(() => (
    patientOtpState?.resendAt
      ? Math.max(0, Math.ceil((patientOtpState.resendAt - Date.now()) / 1000))
      : 0
  ));
  const [otpBusy, setOtpBusy] = useState(false);
  const selectedLogin = loginOptions.find((option) => option.id === loginType);

  useEffect(() => {
    if (!otpChallenge || otpSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setOtpSeconds((seconds) => Math.max(0, seconds - 1));
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [otpChallenge, otpSeconds]);

  useEffect(() => {
    if (isAdminReturn) {
      setLoginType('admin');
    } else if (['patient', 'doctor', 'admin'].includes(requestedLoginType)) {
      setLoginType(requestedLoginType);
    }
  }, [isAdminReturn, requestedLoginType]);

  if (!loading && user && ['patient', 'doctor', 'admin', 'super_admin'].includes(user.role)) {
    return (
      <Navigate
        replace
        to={user.role === 'patient' ? '/patient/dashboard' : roleDashboardPath[user.role]}
      />
    );
  }
  if (isPatientOtpRoute && (!patientOtpState?.challengeId || !patientOtpState?.mobile)) {
    return <Navigate replace to="/patient/login" />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorKey('');
    setSubmitting(true);
    try {
      const signedInUser = await login(identifier.trim(), password, loginType);
      const destination = signedInUser.must_change_password
        ? '/change-password'
        : roleDashboardPath[signedInUser.role] || '/login';
      const adminReturnPath = location.state?.from?.pathname;
      const returnToAdminAccounts = (
        adminReturnPath?.startsWith('/admin/administrators')
        || adminReturnPath === '/admin-registration'
      )
        && signedInUser.role === 'super_admin'
        && signedInUser.permissions?.includes('users:manage');
      const returnToLanguageAssistant = adminReturnPath === '/language-assistant'
        && ['super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient']
          .includes(signedInUser.role)
        && signedInUser.permissions?.includes('languages:use');
      navigate(
        returnToAdminAccounts
          ? `${adminReturnPath}${location.state?.from?.search || ''}`
          : returnToLanguageAssistant
            ? adminReturnPath
            : destination,
        { replace: true },
      );
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      if (code === 'DOCTOR_ACCOUNT_NOT_FOUND') {
        setErrorKey('auth.doctorAccountNotFound');
      } else if (code === 'DOCTOR_APPROVAL_PENDING') {
        setErrorKey('auth.doctorApprovalPending');
      } else if (code === 'DOCTOR_REGISTRATION_REJECTED') {
        setErrorKey('auth.doctorRegistrationRejected');
      } else if (code === 'ADMIN_APPROVAL_PENDING') {
        setErrorKey('auth.adminApprovalPending');
      } else if (code === 'ADMIN_REGISTRATION_REJECTED') {
        setErrorKey('auth.adminRegistrationRejected');
      } else if (code === 'LOGIN_RATE_LIMITED') {
        setErrorKey('auth.rateLimited');
      } else if (code === 'DATABASE_UNAVAILABLE') {
        setErrorKey('auth.databaseUnavailable');
      } else if (!requestError.response) {
        setErrorKey('auth.backendUnreachable');
      } else if (
        requestError.response.status >= 500
      ) {
        setErrorKey('auth.serverUnavailable');
      } else {
        setErrorKey('auth.loginFailed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const requestPatientOtp = async () => {
    setErrorKey('');
    setDemoMode(false);
    setDemoOtp('');
    setDemoOtpCopied(false);
    setOtpBusy(true);
    try {
      const { data } = await api.post('/auth/send-otp', {
        mobile: identifier.trim(),
      });
      const challengeId = data.data.challenge_id;
      const demo = data.data.delivery_mode === 'demo';
      const code = demo ? data.data.demo_otp : '';
      if (demo && !/^\d{6}$/.test(code || '')) {
        setErrorKey('auth.serverUnavailable');
        return;
      }
      const expiresAt = Date.now() + data.data.expires_in * 1000;
      const resendAt = Date.now() + (data.data.resend_after ?? 30) * 1000;
      setDemoMode(demo);
      setDemoOtp(code);
      setOtpChallenge(challengeId);
      setOtpCode('');
      setOtpSeconds(data.data.expires_in);
      setResendSeconds(data.data.resend_after ?? 30);
      navigate('/patient/verify-otp', {
        replace: true,
        state: {
          challengeId,
          mobile: identifier.trim(),
          expiresAt,
          resendAt,
          demoMode: demo,
          demoOtp: code,
          from: location.state?.from,
        },
      });
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      if (code === 'MOBILE_NOT_REGISTERED') {
        navigate('/patient/register', {
          replace: true,
          state: { mobile: identifier.trim() },
        });
        return;
      }
      if (code === 'DATABASE_UNAVAILABLE') {
        setErrorKey('auth.databaseUnavailable');
      } else if (
        code === 'OTP_DELIVERY_UNAVAILABLE'
        || code === 'OTP_DELIVERY_FAILED'
        || code === 'OTP_PROVIDER_UNAVAILABLE'
      ) {
        setErrorKey('auth.otpDeliveryUnavailable');
      } else if (code === 'OTP_RATE_LIMITED') {
        setErrorKey('auth.otpRateLimited');
      } else if (code === 'OTP_RESEND_TOO_SOON') {
        setErrorKey('auth.otpResendTooSoon');
      } else if (code === 'PATIENT_ACCOUNT_INACTIVE') {
        setErrorKey('auth.patientAccountInactive');
      } else if (!requestError.response) {
        setErrorKey('auth.backendUnreachable');
      } else if (requestError.response.status >= 500) {
        setErrorKey('auth.serverUnavailable');
      } else {
        setErrorKey(patientProfileErrorKeys[code] || 'auth.invalidMobile');
      }
    } finally {
      setOtpBusy(false);
    }
  };

  const editPatientMobile = () => {
    setOtpChallenge(null);
    setDemoMode(false);
    setDemoOtp('');
    setDemoOtpCopied(false);
    setOtpCode('');
    setOtpSeconds(0);
    setResendSeconds(0);
    setErrorKey('');
    navigate('/login?type=patient', {
      replace: true,
      state: { mobile: identifier },
    });
  };

  const submitPatientOtp = async (event) => {
    event.preventDefault();
    setErrorKey('');
    setOtpBusy(true);
    try {
      const signedInUser = await loginWithOtp(otpChallenge, otpCode);
      setOtpCode('');
      setDemoOtp('');
      setDemoOtpCopied(false);
      navigate(
        location.state?.from?.pathname === '/language-assistant'
          && ['super_admin', 'admin', 'doctor', 'health_worker', 'specialist', 'patient']
            .includes(signedInUser.role)
          && signedInUser.permissions?.includes('languages:use')
          ? '/language-assistant'
          : signedInUser.role === 'patient'
          ? '/patient/dashboard'
          : roleDashboardPath[signedInUser.role] || '/patient/dashboard',
        { replace: true },
      );
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setErrorKey(patientProfileErrorKeys[code]
        || (code === 'OTP_EXPIRED'
          ? 'auth.otpExpired'
        : code === 'OTP_PROVIDER_UNAVAILABLE'
          ? 'auth.otpVerificationUnavailable'
        : code === 'OTP_INVALID' || code === 'OTP_ATTEMPTS_EXCEEDED'
          ? 'auth.otpInvalid'
          : code === 'OTP_RATE_LIMITED'
          ? 'auth.otpRateLimited'
            : requestError.response?.status >= 500 || !requestError.response
              ? 'auth.serverUnavailable'
              : 'auth.loginFailed'));
    } finally {
      setOtpBusy(false);
    }
  };

  const copyDemoOtp = async () => {
    if (!navigator.clipboard?.writeText) {
      setErrorKey('auth.demoOtpCopyUnavailable');
      return;
    }
    try {
      await navigator.clipboard.writeText(demoOtp);
      setDemoOtpCopied(true);
    } catch {
      setErrorKey('auth.demoOtpCopyUnavailable');
    }
  };

  const otpTime = `${Math.floor(otpSeconds / 60)}:${String(otpSeconds % 60).padStart(2, '0')}`;
  const resendTime = `${Math.floor(resendSeconds / 60)}:${String(resendSeconds % 60).padStart(2, '0')}`;
  const openPasswordRecovery = () => {
    if (loginType !== 'admin') {
      setShowRecoveryHelp(true);
      return;
    }
    setRecoveryEmail(identifier.trim());
    setRecoveryChallenge('');
    setRecoveryCode('');
    setRecoveryToken('');
    setRecoveryPassword('');
    setRecoveryConfirm('');
    setRecoveryError('');
    setRecoverySuccess(false);
    setRecoveryStage('request');
    setShowRecoveryHelp(true);
  };
  const requestRecoveryOtp = async (event) => {
    event.preventDefault();
    setRecoveryError('');
    setRecoveryBusy(true);
    try {
      const { data } = await api.post('/auth/otp/request', {
        target: recoveryEmail.trim(),
        purpose: 'admin_password_reset',
      });
      setRecoveryChallenge(data.data.challenge_id);
      setRecoveryCode('');
      setRecoveryStage('verify');
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setRecoveryError(code === 'OTP_RATE_LIMITED'
        ? 'auth.otpRateLimited'
        : code === 'OTP_RESEND_TOO_SOON'
          ? 'auth.otpResendTooSoon'
          : code === 'OTP_DELIVERY_UNAVAILABLE' || code === 'OTP_DELIVERY_FAILED'
            ? 'auth.otpDeliveryUnavailable'
        : code === 'ACCOUNT_RECOVERY_UNAVAILABLE'
          ? 'auth.recoveryUnavailable'
          : requestError.response?.status >= 500 || !requestError.response
            ? 'auth.serverUnavailable'
            : 'auth.validationFailed');
    } finally {
      setRecoveryBusy(false);
    }
  };
  const verifyRecoveryOtp = async (event) => {
    event.preventDefault();
    setRecoveryError('');
    setRecoveryBusy(true);
    try {
      const { data } = await api.post('/auth/otp/verify', {
        challenge_id: recoveryChallenge,
        code: recoveryCode,
        purpose: 'admin_password_reset',
      });
      setRecoveryToken(data.data.verification_token);
      setRecoveryStage('reset');
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setRecoveryError(code === 'OTP_EXPIRED'
        ? 'auth.otpExpired'
        : code === 'OTP_INVALID' || code === 'OTP_ATTEMPTS_EXCEEDED'
          ? 'auth.otpInvalid'
          : requestError.response?.status >= 500 || !requestError.response
            ? 'auth.serverUnavailable'
            : 'auth.loginFailed');
    } finally {
      setRecoveryBusy(false);
    }
  };
  const submitPasswordRecovery = async (event) => {
    event.preventDefault();
    setRecoveryError('');
    if (recoveryPassword !== recoveryConfirm) {
      setRecoveryError('auth.passwordMismatch');
      return;
    }
    setRecoveryBusy(true);
    try {
      await api.post('/auth/password-reset', {
        email: recoveryEmail.trim(),
        verification_token: recoveryToken,
        password: recoveryPassword,
        confirm: recoveryConfirm,
      });
      setRecoverySuccess(true);
      setRecoveryPassword('');
      setRecoveryConfirm('');
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setRecoveryError(code === 'OTP_VERIFICATION_REQUIRED'
        ? 'auth.otpInvalid'
        : requestError.response?.status === 400 || requestError.response?.status === 422
          ? 'auth.validationFailed'
          : requestError.response?.status >= 500 || !requestError.response
            ? 'auth.serverUnavailable'
            : 'auth.recoveryUnavailable');
    } finally {
      setRecoveryBusy(false);
    }
  };

  return (
    <main className="auth-page auth-page--visual">
      <section aria-labelledby="login-visual-title" className="auth-visual">
        <div className="auth-visual__copy">
          <span className="auth-visual__eyebrow"><ShieldCheck aria-hidden="true" size={19} />{t('loginVisual.eyebrow')}</span>
          <h2 id="login-visual-title"><span>{t('loginVisual.title')}</span><strong>{t('loginVisual.titleLine')}</strong></h2>
          <p>{t('loginVisual.description')}</p>
          <div aria-label={t('loginVisual.features')} className="auth-feature-list">
            <div className="auth-feature-card"><HeartPulse aria-hidden="true" size={31} /><strong>{t('loginVisual.oralHealth')}</strong></div>
            <div className="auth-feature-card"><Users aria-hidden="true" size={31} /><strong>{t('loginVisual.telemedicine')}</strong></div>
            <div className="auth-feature-card"><ShieldCheck aria-hidden="true" size={31} /><strong>{t('loginVisual.trustedCare')}</strong></div>
          </div>
          <a className="auth-get-started" href="#login-title">{t('loginVisual.getStarted')} <ArrowRight aria-hidden="true" size={21} /></a>
        </div>
        <HeartPulse aria-hidden="true" className="auth-visual__heartbeat" size={92} strokeWidth={1.2} />
      </section>
      <section aria-labelledby="login-title" className="auth-card auth-card--login">
        <div className="auth-brand">
          <span aria-hidden="true" className="brand__mark"><HeartPulse size={23} /></span>
          <div><strong>AAROGYA DRISHTI</strong><span>ITDA PADERU</span></div>
        </div>
        <h1 id="login-title">{t(selectedLogin.labelKey)}</h1>
        <p className="auth-description">{t(selectedLogin.descriptionKey)}</p>
        <VoiceGuidanceToggle />
        <div aria-label={t('auth.loginTypeLabel')} className="login-role-options" role="group">
          {loginOptions.map(({ id, icon: Icon, labelKey }) => (
            <button
              aria-pressed={loginType === id}
              className={`login-role-option${loginType === id ? ' login-role-option--active' : ''}`}
              key={id}
              onClick={() => {
                setLoginType(id);
                setErrorKey('');
                setOtpChallenge(null);
                setDemoMode(false);
                setDemoOtp('');
                setDemoOtpCopied(false);
                setOtpCode('');
                setOtpSeconds(0);
                setResendSeconds(0);
              }}
              type="button"
            >
              <Icon aria-hidden="true" size={22} />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
        {loginType === 'patient' ? (
          <div className="auth-form">
            {!otpChallenge && (
              <>
                <div className="mobile-number-field">
                  <span aria-label={t('auth.indiaCountryCode')}>+91</span>
                  <Input
                    autoComplete="tel-national"
                    id="login-identifier"
                    inputMode="numeric"
                    label={t('auth.mobile')}
                    maxLength={16}
                    onChange={(event) => setIdentifier(normalizeIndianMobile(event.target.value))}
                    pattern="[6-9][0-9]{9}"
                    required
                    value={identifier}
                  />
                </div>
                <Button
                  className="auth-submit"
                  disabled={otpBusy || !/^[6-9]\d{9}$/.test(identifier)}
                  onClick={requestPatientOtp}
                  type="button"
                >
                  {otpBusy ? t('loading') : t('auth.sendOtp')}
                </Button>
              </>
            )}
            {otpChallenge && (
              <form className="auth-form" onSubmit={submitPatientOtp}>
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
                  {t('auth.otpSentTo', { mobile: `+91 ${identifier.slice(-4).padStart(10, '*')}` })}
                </p>
                <Button disabled={otpBusy} onClick={editPatientMobile} type="button" variant="outline">
                  {t('auth.editMobile')}
                </Button>
                <OtpCodeInput disabled={otpBusy} onChange={setOtpCode} value={otpCode} />
                <p aria-live="polite" className="auth-hint">
                  {otpSeconds > 0 ? t('auth.otpExpiresIn', { time: otpTime }) : t('auth.otpExpired')}
                </p>
                <Button className="auth-submit" disabled={otpBusy || otpCode.length !== 6 || otpSeconds === 0}>
                  {otpBusy ? t('loading') : t('auth.verifyOtp')}
                </Button>
                <Button
                  disabled={otpBusy || resendSeconds > 0}
                  onClick={requestPatientOtp}
                  type="button"
                  variant="outline"
                >
                  {resendSeconds > 0
                    ? t('auth.resendOtpCountdown', { time: resendTime })
                    : t('auth.resendOtp')}
                </Button>
              </form>
            )}
            {errorKey && <p className="auth-error" role="alert">{t(errorKey)}</p>}
            <p className="auth-switch">
              <Link to="/patient/register">{t('auth.patientRegisterLink')}</Link>
            </p>
          </div>
        ) : (
          <>
            <form className="auth-form" onSubmit={handleSubmit}>
              <Input
                autoComplete="username"
                id="login-identifier"
                icon={Mail}
                label={t(loginType === 'doctor' ? 'auth.doctorEmail' : 'auth.usernameOrEmail')}
                maxLength={254}
                onChange={(event) => setIdentifier(event.target.value)}
                required
                type={loginType === 'doctor' ? 'email' : 'text'}
                value={identifier}
              />
              {loginType !== 'doctor' && <p className="auth-hint">{t('auth.usernameHint')}</p>}
              <div className="password-field">
                <Input
                  autoComplete="current-password"
                  id="login-password"
                  icon={LockKeyhole}
                  label={t('auth.password')}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
                <button
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  className="password-toggle"
                  onClick={() => setShowPassword((shown) => !shown)}
                  type="button"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {errorKey && <p className="auth-error" role="alert">{t(errorKey)}</p>}
              <Button className="auth-submit" disabled={submitting}>
                {submitting ? t('loading') : t('auth.login')}
              </Button>
            </form>
            <button
              className="auth-forgot-link"
              onClick={openPasswordRecovery}
              type="button"
            >
              {t('auth.forgotPassword')}
            </button>
            {loginType === 'admin' && (
              <p className="auth-switch">
                <Link to="/admin-registration">{t('admin.createAdminAccount')}</Link>
              </p>
            )}
          </>
        )}
        {loginType === 'doctor' && (
          <p className="auth-switch">
            <Link to="/register?type=doctor">{t('auth.doctorRequestLink')}</Link>
          </p>
        )}
        {user && !['doctor', 'admin', 'super_admin'].includes(user.role) && (
          <p className="auth-error" role="alert">{t('auth.staffAccessOnly')}</p>
        )}
        <p className="auth-safety">{t('auth.syntheticOnly')}</p>
      </section>
      <Modal
        onClose={() => setShowRecoveryHelp(false)}
        open={showRecoveryHelp}
        title={t('auth.forgotPassword')}
      >
        {loginType !== 'admin' ? (
          <p>{t('auth.passwordRecoveryInstructions')}</p>
        ) : recoverySuccess ? (
          <div>
            <p className="auth-success" role="status">{t('auth.passwordResetSuccess')}</p>
            <Button onClick={() => setShowRecoveryHelp(false)} type="button">
              {t('auth.login')}
            </Button>
          </div>
        ) : (
          <form
            className="auth-form"
            onSubmit={recoveryStage === 'request'
              ? requestRecoveryOtp
              : recoveryStage === 'verify' ? verifyRecoveryOtp : submitPasswordRecovery}
          >
            {recoveryStage === 'request' && (
              <>
                <p>{t('auth.adminRecoveryDescription')}</p>
                <Input
                  autoComplete="email"
                  id="admin-recovery-email"
                  label={t('auth.email')}
                  onChange={(event) => setRecoveryEmail(event.target.value)}
                  required
                  type="email"
                  value={recoveryEmail}
                />
              </>
            )}
            {recoveryStage === 'verify' && (
              <>
                <p>{t('auth.adminRecoveryCodePrompt', { email: recoveryEmail })}</p>
                <OtpCodeInput disabled={recoveryBusy} onChange={setRecoveryCode} value={recoveryCode} />
                <Button disabled={recoveryBusy} onClick={requestRecoveryOtp} type="button" variant="outline">
                  {t('auth.resendOtp')}
                </Button>
              </>
            )}
            {recoveryStage === 'reset' && (
              <>
                <Input
                  autoComplete="new-password"
                  id="admin-recovery-password"
                  label={t('auth.newPassword')}
                  onChange={(event) => setRecoveryPassword(event.target.value)}
                  required
                  type="password"
                  value={recoveryPassword}
                />
                <Input
                  autoComplete="new-password"
                  id="admin-recovery-confirm"
                  label={t('auth.confirmPassword')}
                  onChange={(event) => setRecoveryConfirm(event.target.value)}
                  required
                  type="password"
                  value={recoveryConfirm}
                />
                <p className="auth-hint">{t('auth.passwordPolicy')}</p>
              </>
            )}
            {recoveryError && <p className="auth-error" role="alert">{t(recoveryError)}</p>}
            <Button disabled={recoveryBusy || (recoveryStage === 'verify' && recoveryCode.length !== 6)}>
              {recoveryBusy ? t('loading') : t(recoveryStage === 'request'
                ? 'auth.sendOtp'
                : recoveryStage === 'verify' ? 'auth.verifyOtp' : 'auth.resetPassword')}
            </Button>
          </form>
        )}
      </Modal>
    </main>
  );
}
