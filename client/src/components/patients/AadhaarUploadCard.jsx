import { FileText, ImagePlus, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button.jsx';

export default function AadhaarUploadCard({ side, upload, inputRef, onFile, onRemove, disabled }) {
  const { t } = useTranslation();
  const label = t(`aadhaar.${side}`);

  return (
    <section aria-label={label} className="aadhaar-upload-card">
      <input
        accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
        className="sr-only"
        onChange={onFile}
        ref={inputRef}
        type="file"
      />
      <div className="aadhaar-upload-card__heading">
        {upload?.preview?.startsWith('data:image/') ? (
          <img alt={t('aadhaar.redactedPreview')} className="aadhaar-upload-card__preview" src={upload.preview} />
        ) : upload?.preview?.startsWith('blob:') ? (
          <img alt={t('aadhaar.selectedPreview')} className="aadhaar-upload-card__preview" src={upload.preview} />
        ) : upload?.name?.toLowerCase().endsWith('.pdf') ? (
          <span aria-hidden="true" className="aadhaar-upload-card__file-icon"><FileText size={27} /></span>
        ) : (
          <span aria-hidden="true" className="aadhaar-upload-card__file-icon"><ImagePlus size={27} /></span>
        )}
        <div className="aadhaar-upload-card__copy">
          <h3>{label}</h3>
          <p>{upload?.name || t('aadhaar.fileTypes')}</p>
          {upload?.status === 'stored' && <span className="aadhaar-status aadhaar-status--success">{t('aadhaar.stored')}</span>}
          {upload?.status === 'processing' && <span className="aadhaar-status"><LoaderCircle aria-hidden="true" className="aadhaar-spinner" size={15} />{t('aadhaar.processing')}</span>}
          {upload?.status === 'uploading' && <span className="aadhaar-status">{t('aadhaar.uploading', { progress: upload.progress || 0 })}</span>}
          {upload?.error && <span className="aadhaar-status aadhaar-status--error" role="alert">{t(upload.error)}</span>}
        </div>
      </div>
      {upload?.status === 'uploading' && <progress aria-label={t('aadhaar.uploadProgress')} className="aadhaar-upload-card__progress" max="100" value={upload.progress || 0} />}
      <div className="aadhaar-upload-card__actions">
        <Button disabled={disabled || upload?.status === 'uploading' || upload?.status === 'processing'} onClick={() => inputRef.current?.click()} type="button" variant="outline">
          {upload ? <RefreshCw aria-hidden="true" size={16} /> : <ImagePlus aria-hidden="true" size={16} />}
          {upload ? t('aadhaar.replace') : t('aadhaar.chooseFile')}
        </Button>
        {upload && <Button disabled={upload.status === 'uploading' || upload.status === 'processing'} onClick={onRemove} type="button" variant="outline"><Trash2 aria-hidden="true" size={16} />{t('aadhaar.remove')}</Button>}
      </div>
    </section>
  );
}
