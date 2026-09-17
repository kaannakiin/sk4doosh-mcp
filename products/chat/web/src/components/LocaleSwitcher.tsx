import { SUPPORTED_LOCALES } from "@chat/contracts/common/locale";
import { UnstyledButton } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { useLocaleChoice } from "~/core/hooks/use-locale-choice";
import { useLocale } from "~/core/hooks/use-locale";

export function LocaleSwitcher() {
  const { t } = useTranslation();
  const current = useLocale();
  const choose = useLocaleChoice();

  return (
    <div
      className="flex items-center gap-0.5"
      role="group"
      aria-label={t("locale.label")}
    >
      {SUPPORTED_LOCALES.map((locale) => (
        <UnstyledButton
          key={locale}
          className="rounded-full px-2 py-0.5 text-xs text-ink-dim data-active:bg-raised data-active:text-ink"
          data-active={current === locale ? "" : undefined}
          aria-pressed={current === locale}
          onClick={() => {
            choose(locale);
          }}
        >
          {t(`locale.${locale}`)}
        </UnstyledButton>
      ))}
    </div>
  );
}
