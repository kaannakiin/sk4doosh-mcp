import { isLocale, type Locale } from "@chat/contracts/common/locale";

import { readCookie, writeCookie } from "./cookie";

export const LOCALE_COOKIE = "chat_locale";

export function rememberLocale(locale: Locale): void {
  writeCookie(LOCALE_COOKIE, locale);
}

export function parseLocaleCookie(
  value: string | undefined,
): Locale | undefined {
  return isLocale(value) ? value : undefined;
}

export function readLocaleCookie(): Locale | undefined {
  return parseLocaleCookie(readCookie(LOCALE_COOKIE));
}
