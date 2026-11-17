import { useTranslation } from 'react-i18next';

export default function PublicFooter() {
  const { t } = useTranslation();
  return (
    <footer className="public-footer">
      <strong>{t('brandName')}</strong>
      <p>{t('diseases.footerDisclaimer')}</p>
    </footer>
  );
}
