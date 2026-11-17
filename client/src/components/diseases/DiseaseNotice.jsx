import { useTranslation } from 'react-i18next';

export default function DiseaseNotice() {
  const { t } = useTranslation();
  return (
    <aside aria-label={t('diseases.disclaimer')} className="disease-disclaimer" role="note">
      {t('diseases.disclaimer')}
    </aside>
  );
}
