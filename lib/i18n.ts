import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import de from '@/locales/de.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';
import it from '@/locales/it.json';
import ja from '@/locales/ja.json';
import nl from '@/locales/nl.json';
import pl from '@/locales/pl.json';
import pt from '@/locales/pt.json';
import zh from '@/locales/zh.json';

const SUPPORTED = ['en', 'it', 'es', 'fr', 'de', 'pt', 'nl', 'pl', 'ja', 'zh'];

export const deviceLanguage = (): string => {
  const code = Localization.getLocales()[0]?.languageCode ?? 'en';
  return SUPPORTED.includes(code) ? code : 'en';
};

i18n.use(initReactI18next).init({
  compatibilityJSON: 'v3',
  resources: {
    en: { translation: en },
    it: { translation: it },
    es: { translation: es },
    fr: { translation: fr },
    de: { translation: de },
    pt: { translation: pt },
    nl: { translation: nl },
    pl: { translation: pl },
    ja: { translation: ja },
    zh: { translation: zh },
  },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
