import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from './Button.jsx';

export default function Modal({ open, title, onClose, children }) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        aria-labelledby="modal-title"
        aria-modal="true"
        className="modal"
        role="dialog"
      >
        <header className="modal__header">
          <h2 id="modal-title">{title}</h2>
          <Button aria-label={t('close')} className="icon-button" onClick={onClose} variant="ghost">
            <X size={20} />
          </Button>
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  );
}
