import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from "@chat/contracts/common/locale";
import { match } from "@formatjs/intl-localematcher";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";

import { LOCALE_COOKIE, parseLocaleCookie } from "../lib/locale-cookie";

/**
 * Guard: the explicit choice outranks `Accept-Language`, which is only a first
 * guess. The header states which language the visitor reads, never where they
 * are — an English desktop in Turkey means English, and location is not
 * consulted at all.
 */
const preferredLocale = createServerFn().handler(() => {
  const remembered = parseLocaleCookie(getCookie(LOCALE_COOKIE));
  if (remembered) {
    return remembered;
  }

  const header = getRequestHeader("accept-language");
  const requested = header
    ? header
        .split(",")
        .map((part) => part.split(";")[0]?.trim())
        .filter((tag): tag is string => Boolean(tag))
    : [];

  return match(requested, [...SUPPORTED_LOCALES], DEFAULT_LOCALE);
});

export const Route = createFileRoute("/")({
  loader: async () => {
    throw redirect({
      to: "/$locale",
      params: { locale: await preferredLocale() },
    });
  },
});
