import { isLocale } from "@chat/contracts/common/locale";
import { Outlet, createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { I18nextProvider } from "react-i18next";

import { createI18n } from "../i18n/create-instance";
import { rememberLocale } from "../lib/locale-cookie";

export const Route = createFileRoute("/$locale")({
  beforeLoad: ({ params }) => {
    if (!isLocale(params.locale)) {
      throw notFound();
    }

    return { locale: params.locale };
  },
  component: LocaleLayout,
});

function LocaleLayout() {
  const { locale } = Route.useRouteContext();
  const i18n = useMemo(() => createI18n(locale), [locale]);

  useEffect(() => {
    rememberLocale(locale);
  }, [locale]);

  return (
    <I18nextProvider i18n={i18n}>
      <Outlet />
    </I18nextProvider>
  );
}
