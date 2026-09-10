import { SUPPORTED_LOCALES, type Locale } from "@chat/contracts";
import { Group, Button } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function LocaleSwitcher({ current }: Readonly<{ current: Locale }>) {
  const { t } = useTranslation();

  return (
    <Group gap="xs" aria-label={t("locale.label")}>
      {SUPPORTED_LOCALES.map((locale) => (
        <Button
          key={locale}
          size="xs"
          variant={locale === current ? "filled" : "subtle"}
          renderRoot={(props) => (
            <Link to="/$locale" params={{ locale }} {...props} />
          )}
        >
          {t(`locale.${locale}`)}
        </Button>
      ))}
    </Group>
  );
}
