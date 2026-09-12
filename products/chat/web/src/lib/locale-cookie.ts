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

/**
 * Guard: the cookie is split rather than matched with a RegExp. `document.cookie`
 * is one long attacker-influenceable string — any site-set cookie lands in it —
 * and a pattern with a leading alternation over it is the classic backtracking
 * shape.
 */
export function readLocaleCookie(): Locale | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  for (const entry of document.cookie.split(";")) {
    const separator = entry.indexOf("=");
    if (separator > 0 && entry.slice(0, separator).trim() === LOCALE_COOKIE) {
      return parseLocaleCookie(entry.slice(separator + 1).trim());
    }
  }

  return undefined;
}
