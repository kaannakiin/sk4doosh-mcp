import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
} from "@chat/contracts/common/locale";
import { negotiateLocale } from "@chat/contracts/common/negotiate-locale";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";

import { LOCALE_COOKIE, parseLocaleCookie, readLocaleCookie } from "./locale-cookie";

/**
 * Guard: the explicit choice outranks `Accept-Language`, which is only a first
 * guess for a first visit. The header says which language the visitor reads; it
 * says nothing about where they are, and location is deliberately not an input.
 */
const negotiate = createServerFn().handler(() => {
  return (
    parseLocaleCookie(getCookie(LOCALE_COOKIE)) ??
    negotiateLocale(getRequestHeader("accept-language"), DEFAULT_LOCALE)
  );
});

/**
 * Resolves the language for this render, on either side of the wire.
 *
 * Guard: with no cookie the client reads back the `lang` the server already
 * stamped on `<html>` instead of negotiating again or asking the server. The
 * header is not readable from a browser, so re-deriving here would answer
 * `DEFAULT_LOCALE` and flip a Turkish reader's page to English on the first
 * client navigation.
 */
export async function resolveLocale(): Promise<Locale> {
  const remembered = readLocaleCookie();
  if (remembered !== undefined) {
    return remembered;
  }

  if (typeof document === "undefined") {
    return negotiate();
  }

  const rendered = document.documentElement.lang;

  return isLocale(rendered) ? rendered : DEFAULT_LOCALE;
}
