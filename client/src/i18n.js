import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/translation.json';
import te from './locales/te/translation.json';
import hi from './locales/hi/translation.json';
import or from './locales/or/translation.json';

export const supportedLanguages = ['en', 'te', 'hi', 'or'];
export const resources = {
  en: { translation: en },
  te: { translation: te },
  hi: { translation: hi },
  or: { translation: or },
};

const storedLanguage = typeof localStorage === 'undefined'
  ? null
  : localStorage.getItem('aarogya-language');
const initialLanguage = supportedLanguages.includes(storedLanguage) ? storedLanguage : 'en';

i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  supportedLngs: supportedLanguages,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

function persistLanguage(language) {
  const code = language.split('-')[0];
  if (!supportedLanguages.includes(code)) return;
  if (typeof document !== 'undefined') document.documentElement.lang = code;
  if (typeof localStorage !== 'undefined') localStorage.setItem('aarogya-language', code);
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.resolvedLanguage || initialLanguage;
}
i18n.on('languageChanged', persistLanguage);

export default i18n;
