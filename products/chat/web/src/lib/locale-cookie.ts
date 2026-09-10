import { isLocale, type Locale } from "@chat/contracts/common/locale";

export const LOCALE_COOKIE = "chat_locale";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function rememberLocale(locale: Locale): void {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

export function parseLocaleCookie(
  value: string | undefined,
): Locale | undefined {
  return isLocale(value) ? value : undefined;
}
