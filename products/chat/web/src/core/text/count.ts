import type { Locale } from "@chat/contracts/common/locale";

const formatters = new Map<Locale, Intl.NumberFormat>();

export function asCompact(value: number, locale: Locale): string {
  let formatter = formatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    formatters.set(locale, formatter);
  }

  return formatter.format(value);
}
