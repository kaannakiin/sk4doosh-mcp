import { SUPPORTED_LOCALES } from "@chat/contracts/common/locale";
import { UnstyledButton } from "@mantine/core";
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { rememberLocale } from "../lib/locale-cookie";
import { useLocale } from "../lib/use-locale";

/**
 * Guard: the choice is written to the cookie and the router is invalidated, not
 * navigated. The locale is no longer a path segment, so there is no url to move
 * to — invalidating re-runs the root `beforeLoad`, which reads the cookie back
 * and rebuilds the i18next instance without discarding the conversation on
 * screen or the query cache behind it.
 */
export function LocaleSwitcher() {
  const { t } = useTranslation();
  const router = useRouter();
  const current = useLocale();

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={t("locale.label")}>
      {SUPPORTED_LOCALES.map((locale) => (
        <UnstyledButton
          key={locale}
          className="rounded-full px-2 py-0.5 text-xs text-ink-dim data-active:bg-raised data-active:text-ink"
          data-active={current === locale ? "" : undefined}
          aria-pressed={current === locale}
          onClick={() => {
            rememberLocale(locale);
            void router.invalidate();
          }}
        >
          {t(`locale.${locale}`)}
        </UnstyledButton>
      ))}
    </div>
  );
}
