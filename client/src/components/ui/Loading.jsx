import { useTranslation } from 'react-i18next';

export default function Loading() {
  const { t } = useTranslation();
  return (
    <div aria-label={t('loading')} className="loading" role="status">
      <span className="loading__spinner" />
      <span>{t('loading')}</span>
    </div>
  );
}
