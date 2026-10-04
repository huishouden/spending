import en from './locales/en.json';
import { registerMessages } from '@huishouden/pwa-kit/i18n';
type AppEn = typeof en;
declare module '@huishouden/pwa-kit/i18n' { interface AppMessages extends AppEn {} }
registerMessages(en, { es: () => import('./locales/es.json'), nl: () => import('./locales/nl.json') });
export { t, startI18n } from '@huishouden/pwa-kit/i18n';
export { useT, useLocale, useLang } from '@huishouden/pwa-kit/react/i18n';
