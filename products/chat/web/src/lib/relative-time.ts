import type { Locale } from "@chat/contracts/common/locale";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 4 * WEEK;

/**
 * Guard: formatters are cached per locale. `Intl.RelativeTimeFormat` is
 * expensive to construct, and the sidebar would build one per row per render.
 */
const relative = new Map<Locale, Intl.RelativeTimeFormat>();
const absolute = new Map<Locale, Intl.DateTimeFormat>();

function relativeFor(locale: Locale): Intl.RelativeTimeFormat {
  let formatter = relative.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relative.set(locale, formatter);
  }

  return formatter;
}

function absoluteFor(locale: Locale): Intl.DateTimeFormat {
  let formatter = absolute.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    absolute.set(locale, formatter);
  }

  return formatter;
}

/**
 * Renders how long ago an ISO timestamp was, in the visitor's language.
 *
 * @returns a relative phrase under roughly a month, an absolute date beyond it
 */
export function formatRelative(iso: string, locale: Locale): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }

  const elapsed = Date.now() - then;
  const format = relativeFor(locale);

  if (elapsed < MINUTE) {
    return format.format(0, "minute");
  }
  if (elapsed < HOUR) {
    return format.format(-Math.floor(elapsed / MINUTE), "minute");
  }
  if (elapsed < DAY) {
    return format.format(-Math.floor(elapsed / HOUR), "hour");
  }
  if (elapsed < WEEK) {
    return format.format(-Math.floor(elapsed / DAY), "day");
  }
  if (elapsed < MONTH) {
    return format.format(-Math.floor(elapsed / WEEK), "week");
  }

  return absoluteFor(locale).format(then);
}

export function formatBytes(bytes: number, locale: Locale): string {
  const units = ["B", "KB", "MB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
  }).format(value)} ${units[unit]}`;
}
