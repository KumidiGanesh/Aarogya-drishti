import { useEffect } from 'react';
import { HeartPulse } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function PublicHeader({ variant = 'default', onContactClick, onServicesClick }) {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = (i18n.resolvedLanguage || i18n.language).split('-')[0];
  }, [i18n.language, i18n.resolvedLanguage]);

  const changeLanguage = (event) => {
    const language = event.target.value;
    i18n.changeLanguage(language);
  };

  return (
    <header className={`public-header${variant === 'glass' ? ' public-header--glass' : ''}`}>
      <Link aria-label={t('brandName')} className="public-brand" to="/">
        <span aria-hidden="true" className="public-brand__mark"><HeartPulse size={25} /></span>
        {variant === 'glass' ? <span className="public-brand__wordmark"><strong>AAROGYA DRISHTI</strong><small>ITDA PADERU</small></span> : <span>{t('brandName')}</span>}
      </Link>
      {variant === 'glass' && <nav aria-label={t('publicNav.mainNavigation')} className="reference-nav">
        <a className="reference-nav__active" href="#home">{t('publicNav.home')}</a>
        <a href="#services" onClick={onServicesClick}>{t('publicNav.services')}</a>
        <Link to="/oral-diseases">{t('publicNav.about')}</Link>
        <Link to="/appointments/book">{t('publicNav.doctors')}</Link>
        <button className="reference-nav__contact" onClick={onContactClick} type="button">{t('publicNav.contact')}</button>
      </nav>}
      <nav aria-label={t('diseases.sectionTitle')} className="public-header__actions">
        <label className="sr-only" htmlFor={variant === 'glass' ? 'glass-language-select' : 'public-language-select'}>{t('language')}</label>
        {variant === 'glass' && <span aria-hidden="true" className="reference-language-icon">◎</span>}
        <select aria-label={t('language')} className="public-language-select" id={variant === 'glass' ? 'glass-language-select' : 'public-language-select'} name="language" onChange={changeLanguage} value={i18n.language}>
          <option value="en">EN</option><option value="te">తెలుగు</option><option value="hi">हिन्दी</option><option value="or">ଓଡ଼ିଆ</option>
        </select>
        <Link className="button button--primary" to="/login">{t('diseases.login')}</Link>
      </nav>
    </header>
  );
}
