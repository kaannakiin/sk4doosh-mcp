import type { Locale } from "@chat/contracts/common/locale";
import type { i18n } from "i18next";
import { useEffect, useMemo } from "react";

import { createI18n } from "~/i18n/create-instance";
import { rememberLocale } from "~/lib/locale-cookie";

/**
 * The i18next instance this tree renders with, and the cookie that carries the
 * same choice into the next request.
 *
 * Guard: keyed on the locale, never rebuilt per render. `createI18n` runs
 * `init`, so an instance per render would re-parse every bundle on every
 * keystroke and hand `I18nextProvider` a new context value each time.
 */
export function useI18nRuntime(locale: Locale): i18n {
  const instance = useMemo(() => createI18n(locale), [locale]);

  useEffect(() => {
    rememberLocale(locale);
  }, [locale]);

  return instance;
}
