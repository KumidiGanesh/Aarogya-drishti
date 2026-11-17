import { MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

let reportedInvalidNumber;

export function getWhatsAppHref(number, message) {
  if (typeof number !== 'string' || !/^\+?[\d\s()-]+$/.test(number.trim())) return null;
  const normalized = number?.replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(normalized || '')) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

function getConfiguredNumber() {
  const number = import.meta.env.VITE_WHATSAPP_NUMBER?.trim();
  if (number && !getWhatsAppHref(number, '')) {
    if (reportedInvalidNumber !== number) {
      console.error('VITE_WHATSAPP_NUMBER must include 8 to 15 digits with a country code.');
      reportedInvalidNumber = number;
    }
  }
  return number;
}

export default function WhatsAppContact() {
  const { t } = useTranslation();
  const href = getWhatsAppHref(getConfiguredNumber(), t('phase10.whatsappPrefilledMessage'));
  if (!href) return null;

  const label = t('phase10.whatsappContactLabel');
  return (
    <a
      aria-label={label}
      className="whatsapp-contact"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      title={label}
    >
      <MessageCircle aria-hidden="true" size={22} />
      <span>WhatsApp</span>
    </a>
  );
}
