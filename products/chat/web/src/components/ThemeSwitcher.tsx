import {
  UnstyledButton,
  useMantineColorScheme,
  type MantineColorScheme,
} from "@mantine/core";
import { IconDeviceLaptop, IconMoon, IconSun } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const OPTIONS = [
  { value: "light", Icon: IconSun },
  { value: "dark", Icon: IconMoon },
  { value: "auto", Icon: IconDeviceLaptop },
] as const satisfies readonly {
  value: MantineColorScheme;
  Icon: typeof IconSun;
}[];

/**
 * Guard: the buttons carry `aria-label` and `aria-pressed` rather than being a
 * segmented control of icon-only radios, which have no accessible name at all.
 *
 * Guard: the first client render reads `"auto"`, the same value the server
 * rendered — Mantine restores the stored choice in an effect — so this stays
 * free of a hydration mismatch without being deferred behind a mounted flag.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={t("theme.label")}>
      {OPTIONS.map(({ value, Icon }) => (
        <UnstyledButton
          key={value}
          className="grid size-7 place-items-center rounded-md text-ink-dim hover:text-ink data-active:bg-raised data-active:text-ink"
          data-active={colorScheme === value ? "" : undefined}
          aria-pressed={colorScheme === value}
          aria-label={t(`theme.${value}`)}
          onClick={() => {
            setColorScheme(value);
          }}
        >
          <Icon size={14} />
        </UnstyledButton>
      ))}
    </div>
  );
}
