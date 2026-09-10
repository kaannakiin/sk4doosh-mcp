import { DEFAULT_LOCALE } from "@chat/contracts/common/locale";
import { negotiateLocale } from "@chat/contracts/common/negotiate-locale";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";

import { LOCALE_COOKIE, parseLocaleCookie } from "../lib/locale-cookie";

/**
 * Guard: the explicit choice outranks `Accept-Language`, which is only a first
 * guess for a first visit.
 */
const preferredLocale = createServerFn().handler(() => {
  const remembered = parseLocaleCookie(getCookie(LOCALE_COOKIE));

  return (
    remembered ??
    negotiateLocale(getRequestHeader("accept-language"), DEFAULT_LOCALE)
  );
});

export const Route = createFileRoute("/")({
  loader: async () => {
    throw redirect({
      to: "/$locale",
      params: { locale: await preferredLocale() },
    });
  },
});
