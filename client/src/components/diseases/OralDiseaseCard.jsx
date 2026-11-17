import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import oralDiseases from '../../data/oralDiseases.json';
import DiseaseInformation from './DiseaseInformation.jsx';
import DiseaseArtwork from './DiseaseArtwork.jsx';

export function getDiseaseName(disease, language) {
  const key = `name_${language}`;
  return disease[key] || disease.name_en;
}

export default function OralDiseaseCard({ disease }) {
  const { t, i18n } = useTranslation();
  const localizedName = t(`diseases.conditionNames.${disease.id}`, {
    defaultValue: getDiseaseName(disease, i18n.language),
  });

  return (
    <article aria-labelledby={`disease-${disease.id}`} className="oral-disease-card">
      <Link
        aria-label={`${t('diseases.learnMore')}: ${localizedName}`}
        to={`/diseases/${disease.id}`}
      >
        <DiseaseArtwork
          alt={t('diseases.imageAlt', { name: localizedName })}
          className="oral-disease-card__image"
          disease={disease}
        />
      </Link>
      {disease.clinical_photo && (
        <a
          className="oral-disease-card__photo-credit"
          href={disease.clinical_photo.source_url}
          rel="noreferrer noopener"
          target="_blank"
        >
          {t('diseases.photoCredit', {
            credit: disease.clinical_photo.credit,
            license: disease.clinical_photo.license,
          })}
        </a>
      )}
      <div className="oral-disease-card__content">
        <span className="disease-category">{t(`diseases.categories.${disease.category}`)}</span>
        <h2 id={`disease-${disease.id}`} lang="en">
          {disease.name_en}
        </h2>
        <p className="oral-disease-card__telugu" lang="te">
          {disease.name_te}
        </p>
        {i18n.language !== 'en' && i18n.language !== 'te' && (
          <p className="oral-disease-card__localized" lang={i18n.language}>
            {localizedName}
          </p>
        )}
        <p className="oral-disease-card__description" lang="en">
          {disease.short_description}
        </p>
        <DiseaseInformation disease={disease} />
        <Link
          className="button button--outline oral-disease-card__more"
          to={`/diseases/${disease.id}`}
        >
          {t('diseases.learnMore')}
        </Link>
      </div>
    </article>
  );
}

export { oralDiseases };
