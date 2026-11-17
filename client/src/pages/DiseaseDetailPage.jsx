import { useEffect } from 'react';
import { ArrowLeft, Volume2 } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import oralDiseases from '../data/oralDiseases.json';
import PublicHeader from '../components/diseases/PublicHeader.jsx';
import PublicFooter from '../components/diseases/PublicFooter.jsx';
import DiseaseInformation from '../components/diseases/DiseaseInformation.jsx';
import DiseaseArtwork from '../components/diseases/DiseaseArtwork.jsx';
import VoiceGuidanceToggle from '../components/VoiceGuidanceToggle.jsx';

const speechLanguages = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN', or: 'or-IN' };

export default function DiseaseDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const disease = oralDiseases.find((entry) => entry.id === id);
  const localizedName = disease
    ? t(`diseases.conditionNames.${disease.id}`, {
        defaultValue: disease[`name_${i18n.language}`] || disease.name_en,
      })
    : '';

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );

  if (!disease) return <Navigate replace to="/" />;

  const speakSummary = () => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    window.speechSynthesis.cancel();
    const text =
      i18n.language === 'en'
        ? [
            disease.name_en,
            disease.short_description,
            ...disease.common_symptoms,
            ...disease.risk_factors,
            ...disease.prevention_and_hygiene,
            disease.when_to_consult_doctor,
            t('diseases.disclaimer'),
          ].join('. ')
        : t('diseases.audioIntro', { name: localizedName });
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLanguages[i18n.language] || speechLanguages.en;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="public-page">
      <a className="skip-link" href="#main-content">
        {t('diseases.skipContent')}
      </a>
      <PublicHeader />
      <main className="disease-detail-page" id="main-content">
        <VoiceGuidanceToggle />
        <Link className="disease-back-link" to="/#oral-diseases">
          <ArrowLeft aria-hidden="true" size={18} />
          {t('diseases.sectionTitle')}
        </Link>
        <article className="disease-detail">
          <figure className="disease-detail__artwork">
            <DiseaseArtwork
              alt={t('diseases.imageAlt', { name: localizedName })}
              className="disease-detail__image"
              disease={disease}
            />
            {disease.clinical_photo && (
              <figcaption className="disease-image-credit">
                <a
                  href={disease.clinical_photo.source_url}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {t('diseases.photoCredit', {
                    credit: disease.clinical_photo.credit,
                    license: disease.clinical_photo.license,
                  })}
                </a>
              </figcaption>
            )}
          </figure>
          <div className="disease-detail__content">
            <span className="disease-category">{t(`diseases.categories.${disease.category}`)}</span>
            <h1 lang="en">{disease.name_en}</h1>
            <p className="oral-disease-card__telugu" lang="te">
              {disease.name_te}
            </p>
            {i18n.language !== 'en' && i18n.language !== 'te' && (
              <p lang={i18n.language}>{localizedName}</p>
            )}
            <p className="disease-detail__description" lang="en">
              {disease.short_description}
            </p>
            <button className="button button--outline" onClick={speakSummary} type="button">
              <Volume2 aria-hidden="true" size={19} />
              {t('diseases.audio')}
            </button>
            <p className="medical-translation-notice">{t('diseases.translationNotice')}</p>
            <DiseaseInformation disease={disease} />
            {!disease.clinical_photo && (
              <p className="disease-image-credit disease-image-credit--illustration">
                <strong>{t('diseases.imageCredit')}:</strong> {disease.image_credit}
              </p>
            )}
            <Link className="button button--primary disease-appointment-link" to="/login">
              {t('diseases.bookAppointment')}
            </Link>
          </div>
        </article>
      </main>
      <PublicFooter />
    </div>
  );
}
