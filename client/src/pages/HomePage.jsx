import { useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, Languages, Pill, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PublicHeader from '../components/diseases/PublicHeader.jsx';
import PublicFooter from '../components/diseases/PublicFooter.jsx';
import OralDiseaseCard, { oralDiseases } from '../components/diseases/OralDiseaseCard.jsx';
import DiseaseNotice from '../components/diseases/DiseaseNotice.jsx';
import { getWhatsAppHref } from '../components/WhatsAppContact.jsx';
import doctorPhoto from '../assets/login-healthcare.png';

export default function HomePage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isDiseaseCatalogPage = pathname === '/oral-diseases';
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [contactOpen, setContactOpen] = useState(false);
  const filteredDiseases = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return oralDiseases.filter((disease) => {
      const matchesCategory = category === 'all' || disease.category === category;
      const searchableText = [disease.name_en, disease.name_te, disease.name_hi, disease.name_or, disease.short_description].join(' ').toLocaleLowerCase();
      return matchesCategory && (!normalizedSearch || searchableText.includes(normalizedSearch));
    });
  }, [category, search]);

  if (isDiseaseCatalogPage) {
    return <div className="public-page"><a className="skip-link" href="#main-content">{t('diseases.skipContent')}</a><PublicHeader />
      <main id="main-content"><section className="oral-diseases-section" id="oral-diseases">
        <div className="home-section-heading"><p className="eyebrow">{t('appName')}</p><h1>{t('diseases.sectionTitle')}</h1><p>{t('diseases.sectionDescription')}</p></div>
        <DiseaseNotice /><p className="medical-translation-notice">{t('diseases.translationNotice')}</p>
        <div className="disease-filter-bar">
          <label className="disease-search"><span className="sr-only">{t('diseases.searchLabel')}</span><input onChange={(event) => setSearch(event.target.value)} placeholder={t('diseases.searchLabel')} type="search" value={search} /></label>
          <label className="disease-category-filter"><span>{t('diseases.categoryLabel')}</span><select onChange={(event) => setCategory(event.target.value)} value={category}><option value="all">{t('diseases.allCategories')}</option>{Object.entries(t('diseases.categories', { returnObjects: true })).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        {filteredDiseases.length ? <div className="oral-disease-grid">{filteredDiseases.map((disease) => <OralDiseaseCard disease={disease} key={disease.id} />)}</div> : <p className="disease-no-results" role="status">{t('diseases.noResults')}</p>}
      </section></main><PublicFooter />
    </div>;
  }

  return <div className="reference-home" id="home">
    <a className="skip-link" href="#main-content">{t('diseases.skipContent')}</a>
    <div aria-hidden="true" className="reference-orb reference-orb--top" />
    <div aria-hidden="true" className="reference-orb reference-orb--left" />
    <div aria-hidden="true" className="reference-orb reference-orb--bottom" />
    <div aria-hidden="true" className="reference-orb reference-orb--right" />
    <div className="reference-glass-panel">
      <PublicHeader
        onContactClick={() => setContactOpen(true)}
        onServicesClick={(event) => {
          event.preventDefault();
          window.history.replaceState(null, '', '#services');
          document.getElementById('services')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
        variant="glass"
      />
      <main id="main-content">
        <section aria-labelledby="reference-hero-title" className="reference-hero">
          <div className="reference-hero__copy">
            <p className="reference-welcome">{t('publicHome.welcome')}</p>
            <h1 id="reference-hero-title">{t('publicHome.title')}</h1>
            <p className="reference-hero__description">{t('publicHome.description')}</p>
            <div className="reference-hero__actions">
              <Link className="reference-button reference-button--primary" to="/appointments/book">{t('publicHome.bookAppointment')} <ArrowRight aria-hidden="true" size={19} /></Link>
              <Link className="reference-button reference-button--secondary" to="/oral-diseases">{t('publicHome.readMore')} <ArrowRight aria-hidden="true" size={19} /></Link>
            </div>
          </div>
          <div className="reference-doctor-stage" aria-label={t('publicHome.imageAlt')}>
            <div aria-hidden="true" className="reference-doctor-triangle" />
            <div aria-hidden="true" className="reference-doctor-ribbon reference-doctor-ribbon--back" />
            <div aria-hidden="true" className="reference-doctor-ribbon reference-doctor-ribbon--front" />
            <img alt={t('publicHome.imageAlt')} className="reference-doctor-image" fetchPriority="high" src={doctorPhoto} />
          </div>
        </section>
        <section aria-label={t('publicHome.services')} className="reference-service-grid" id="services">
          <Link className="reference-service-card" to="/language-assistant">
            <span className="reference-service-card__icon"><Languages aria-hidden="true" size={27} /></span>
            <strong>{t('publicHome.languageAssistant')}</strong>
            <span>{t('publicHome.languageAssistantDescription')}</span>
            <span className="reference-service-card__action">{t('publicHome.openLanguageAssistant')} <ArrowRight aria-hidden="true" size={17} /></span>
          </Link>
          <Link className="reference-service-card" to="/appointments/book">
            <span className="reference-service-card__icon"><CalendarDays aria-hidden="true" size={27} /></span>
            <strong>{t('publicHome.appointment')}</strong><span>{t('publicHome.appointmentDescription')}</span><span className="reference-service-card__action">{t('publicHome.bookOnline')} <ArrowRight aria-hidden="true" size={17} /></span>
          </Link>
          <Link className="reference-service-card" to="/medicines">
            <span className="reference-service-card__icon"><Pill aria-hidden="true" size={27} /></span>
            <strong>{t('publicHome.medicines')}</strong><span>{t('publicHome.medicinesDescription')}</span><span className="reference-service-card__action">{t('publicHome.viewMedicines')} <ArrowRight aria-hidden="true" size={17} /></span>
          </Link>
          <Link className="reference-service-card" to="/appointments/book">
            <span className="reference-service-card__icon"><Users aria-hidden="true" size={27} /></span>
            <strong>{t('publicHome.doctors')}</strong><span>{t('publicHome.doctorsDescription')}</span><span className="reference-service-card__action">{t('publicHome.findDoctors')} <ArrowRight aria-hidden="true" size={17} /></span>
          </Link>
        </section>
      </main>
    </div>
    {contactOpen && <div className="reference-contact-backdrop" onClick={() => setContactOpen(false)}>
      <section aria-labelledby="reference-contact-title" aria-modal="true" className="reference-contact-dialog" onClick={(event) => event.stopPropagation()} role="dialog" tabIndex={-1}>
        <button aria-label={t('publicHome.closeContact')} className="reference-contact-close" onClick={() => setContactOpen(false)} type="button">×</button>
        <p className="reference-welcome">Aarogya Drishti</p>
        <h2 id="reference-contact-title">{t('publicHome.contactTitle')}</h2>
        <p>{t('publicHome.contactDescription')}</p>
        {getWhatsAppHref(import.meta.env.VITE_WHATSAPP_NUMBER, t('phase10.whatsappPrefilledMessage'))
          ? <a className="reference-button reference-button--primary" href={getWhatsAppHref(import.meta.env.VITE_WHATSAPP_NUMBER, t('phase10.whatsappPrefilledMessage'))} rel="noreferrer" target="_blank">{t('publicHome.whatsapp')} <ArrowRight aria-hidden="true" size={18} /></a>
          : <p className="reference-contact-note">{t('publicHome.localSupport')}</p>}
        <Link className="reference-button reference-button--secondary" onClick={() => setContactOpen(false)} to="/appointments/book">{t('publicHome.bookAgain')} <ArrowRight aria-hidden="true" size={18} /></Link>
      </section>
    </div>}
  </div>;
}
