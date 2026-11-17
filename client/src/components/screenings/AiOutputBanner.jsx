import { useTranslation } from 'react-i18next';

export default function AiOutputBanner({ compact = false, isDemo = false, isFailed = false }) {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={t(
        isDemo
          ? 'screening.aiDemoDisclaimer'
          : isFailed
            ? 'screening.aiFailedDisclaimer'
            : 'screening.aiDisclaimer',
      )}
      className={`screening-ai-banner ${compact ? 'screening-ai-banner--compact' : ''}`.trim()}
      role="note"
    >
      <strong>
        {t(
          isDemo
            ? 'screening.aiDemoDisclaimer'
            : isFailed
              ? 'screening.aiFailedDisclaimer'
              : 'screening.aiDisclaimer',
        )}
      </strong>
      <span>
        {t(
          isDemo
            ? 'screening.aiDemoBanner'
            : isFailed
              ? 'screening.aiFailedBanner'
              : 'screening.aiBanner',
        )}
      </span>
      <p>{t('screening.aiSafety')}</p>
      <p>{t('screening.doctorReview')}</p>
    </aside>
  );
}
