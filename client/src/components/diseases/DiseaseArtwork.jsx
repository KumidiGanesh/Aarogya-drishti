import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DiseaseIllustration from './DiseaseIllustration.jsx';

export default function DiseaseArtwork({ disease, alt, className }) {
  const { t } = useTranslation();
  const [photoUnavailable, setPhotoUnavailable] = useState(false);
  const showPhoto = disease.clinical_photo && !photoUnavailable;

  return (
    <div className="disease-artwork">
      {showPhoto ? (
        <img
          alt={alt}
          className={className}
          decoding="async"
          loading="lazy"
          data-clinical-photo={disease.id}
          onError={() => setPhotoUnavailable(true)}
          referrerPolicy="no-referrer"
          src={disease.clinical_photo.url}
        />
      ) : (
        <DiseaseIllustration alt={alt} className={className} disease={disease} />
      )}
      <span className="disease-artwork__label">
        {showPhoto ? t('diseases.clinicalPhotoLabel') : t('diseases.illustrationLabel')}
      </span>
      {photoUnavailable && (
        <span className="disease-artwork__unavailable" role="status">
          {t('diseases.photoUnavailable')}
        </span>
      )}
    </div>
  );
}
