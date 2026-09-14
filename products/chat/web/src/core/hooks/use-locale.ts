import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
} from "@chat/contracts/common/locale";
import { useTranslation } from "react-i18next";

/**
 * The language this subtree renders in.
 *
 * Guard: read from the i18next instance rather than from the router. The locale
 * left the url deliberately, and sourcing it from the provider is what keeps
 * every component below here ignorant of how it was resolved — a cookie here, a
 * device setting on a native client.
 */
export function useLocale(): Locale {
  const { i18n } = useTranslation();

  return isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}
