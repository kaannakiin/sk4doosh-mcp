import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from "@chat/contracts";
import i18next, { type i18n } from "i18next";

import en from "./locales/en/common.json";
import tr from "./locales/tr/common.json";

const resources = {
  en: { common: en },
  tr: { common: tr },
};

/**
 * Guard: a fresh instance per render. SSR serves many requests from one Node
 * process, so a module-level singleton would leak one visitor's language into
 * another's render the moment `changeLanguage` runs.
 */
export function createI18n(locale: Locale): i18n {
  const instance = i18next.createInstance();

  instance.init({
    lng: locale,
    resources,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
  });

  return instance;
}
