import { useTranslation } from 'react-i18next';
import Button from './Button.jsx';

export default function Pagination({ page, totalPages, onPageChange }) {
  const { t } = useTranslation();
  const pages = Math.max(1, totalPages);
  return (
    <nav aria-label={t('pagination')} className="pagination">
      <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)} variant="outline">
        {t('previous')}
      </Button>
      <span aria-live="polite">{t('pageOf', { page, totalPages: pages })}</span>
      <Button disabled={page >= pages} onClick={() => onPageChange(page + 1)} variant="outline">
        {t('next')}
      </Button>
    </nav>
  );
}
