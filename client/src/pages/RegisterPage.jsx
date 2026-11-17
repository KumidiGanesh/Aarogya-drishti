import { useState } from 'react';
import { Eye, EyeOff, HeartPulse } from 'lucide-react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Select from '../components/ui/Select.jsx';
import VoiceGuidanceToggle from '../components/VoiceGuidanceToggle.jsx';

export default function RegisterPage() {
  const { t } = useTranslation();
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isDoctorRequest = searchParams.get('type') === 'doctor';
  const [fields, setFields] = useState({
    full_name: '',
    mobile: '',
    email: '',
    password: '',
    preferred_language: 'en',
    registration_number: '',
    qualification: '',
    specialty: '',
    facility_name: '',
    district: '',
  });
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const [validationDetails, setValidationDetails] = useState([]);
  const [success, setSuccess] = useState(false);

  if (!loading && user) return <Navigate replace to="/" />;

  const update = (key) => (event) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));
  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorKey('');
    setValidationDetails([]);
    if (fields.password !== confirm) {
      setErrorKey('auth.passwordMismatch');
      return;
    }
    setSubmitting(true);
    try {
      await register({
        ...fields,
        account_type: isDoctorRequest ? 'doctor' : 'patient',
        email: fields.email.trim() || undefined,
      });
      setSuccess(true);
      if (!isDoctorRequest) {
        window.setTimeout(() => navigate('/login', { replace: true }), 1200);
      }
    } catch (requestError) {
      const validationErrors = requestError.response?.data?.errors;
      if (requestError.response?.data?.code === 'VALIDATION_ERROR' && Array.isArray(validationErrors)) {
        const validFields = new Set([
          'full_name',
          'mobile',
          'email',
          'password',
          'preferred_language',
          'registration_number',
          'specialty',
          'facility_name',
          'district',
        ]);
        setValidationDetails(
          [...new Set(validationErrors.map((issue) => issue.path?.split('.').pop())
            .filter((field) => validFields.has(field)))],
        );
      }
      setErrorKey(
        ['ACCOUNT_EXISTS', 'EMAIL_ALREADY_REGISTERED'].includes(requestError.response?.data?.code)
          ? 'auth.accountExists'
          : requestError.response?.status === 400
            ? 'auth.validationFailed'
            : 'auth.registerFailed',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section aria-labelledby="register-title" className="auth-card auth-card--wide">
        <div className="auth-brand">
          <span aria-hidden="true" className="brand__mark"><HeartPulse size={23} /></span>
          <div><strong>{t('brandName')}</strong><span>{t('demoNotice')}</span></div>
        </div>
        <h1 id="register-title">
          {t(isDoctorRequest ? 'auth.doctorRegisterTitle' : 'auth.registerTitle')}
        </h1>
        <p className="auth-description">
          {t(isDoctorRequest ? 'auth.doctorRegisterDescription' : 'auth.registerDescription')}
        </p>
        <VoiceGuidanceToggle />
        <form className="auth-form" onSubmit={handleSubmit}>
          <Input
            autoComplete="name"
            id="register-name"
            label={t('auth.fullName')}
            maxLength={160}
            onChange={update('full_name')}
            required
            value={fields.full_name}
          />
          <Input
            autoComplete="tel-national"
            id="register-mobile"
            inputMode="numeric"
            label={t('auth.mobile')}
            maxLength={10}
            onChange={(event) => update('mobile')({ target: { value: event.target.value.replace(/\D/g, '').slice(0, 10) } })}
            pattern="[6-9][0-9]{9}"
            required
            value={fields.mobile}
          />
          <Input
            autoComplete="email"
            id="register-email"
            label={t(isDoctorRequest ? 'auth.email' : 'auth.emailOptional')}
            maxLength={254}
            onChange={update('email')}
            required={isDoctorRequest}
            type="email"
            value={fields.email}
          />
          {isDoctorRequest && (
            <>
              <Input
                id="register-doctor-number"
                label={t('auth.registrationNumber')}
                maxLength={100}
                onChange={update('registration_number')}
                required
                value={fields.registration_number}
              />
              <Input
                id="register-doctor-qualification"
                label={t('auth.qualificationOptional')}
                maxLength={200}
                onChange={update('qualification')}
                value={fields.qualification}
              />
              <Input
                id="register-doctor-specialty"
                label={t('auth.specialty')}
                maxLength={160}
                onChange={update('specialty')}
                required
                value={fields.specialty}
              />
              <Input
                id="register-doctor-facility"
                label={t('auth.facilityName')}
                maxLength={160}
                onChange={update('facility_name')}
                required
                value={fields.facility_name}
              />
              <Input
                autoComplete="address-level2"
                id="register-doctor-district"
                label={t('patient.district')}
                maxLength={100}
                onChange={update('district')}
                required
                value={fields.district}
              />
            </>
          )}
          <Select
            id="register-language"
            label={t('language')}
            onChange={update('preferred_language')}
            value={fields.preferred_language}
          >
            <option value="en">{t('languages.en')}</option>
            <option value="te">{t('languages.te')}</option>
            <option value="hi">{t('languages.hi')}</option>
            <option value="or">{t('languages.or')}</option>
          </Select>
          <div className="password-field">
            <Input
              autoComplete="new-password"
              id="register-password"
              label={t('auth.password')}
              onChange={update('password')}
              required
              type={showPassword ? 'text' : 'password'}
              value={fields.password}
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
          <Input
            autoComplete="new-password"
            id="register-confirm"
            label={t('auth.confirmPassword')}
            onChange={(event) => setConfirm(event.target.value)}
            required
            type="password"
            value={confirm}
          />
          <p className="auth-hint">{t('auth.passwordPolicy')}</p>
          {errorKey && (
            <div className="auth-error" role="alert">
              <p>{t(errorKey)}</p>
              {validationDetails.length > 0 && (
                <ul>
                  {validationDetails.map((field) => (
                    <li key={field}>{t(`auth.validationFields.${field}`)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {success && (
            <p className="auth-success" role="status">
              {t(isDoctorRequest ? 'auth.doctorRequestSuccess' : 'auth.registerSuccess')}
            </p>
          )}
          <Button className="auth-submit" disabled={submitting || success}>
            {submitting
              ? t('loading')
              : t(isDoctorRequest ? 'auth.submitDoctorRequest' : 'auth.register')}
          </Button>
        </form>
        <p className="auth-switch">
          {t('auth.haveAccount')} <Link to="/login">{t('auth.loginLink')}</Link>
        </p>
        <p className="auth-safety">{t('auth.syntheticOnly')}</p>
      </section>
    </main>
  );
}
