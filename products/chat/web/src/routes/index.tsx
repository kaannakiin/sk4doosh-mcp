import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from "@chat/contracts/common/locale";
import { match } from "@formatjs/intl-localematcher";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

const preferredLocale = createServerFn().handler(() => {
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
