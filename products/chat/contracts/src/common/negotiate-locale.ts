import { DEFAULT_LOCALE, isLocale, type Locale } from "./locale.ts";

interface RankedTag {
  language: string;
  quality: number;
}

function rank(header: string): RankedTag[] {
  return header
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="))
        ?.slice(2);

      return {
        language: (tag ?? "").trim().toLowerCase().split("-")[0] ?? "",
        quality: quality === undefined ? 1 : Number.parseFloat(quality),
      };
    })
    .filter((ranked) => ranked.language.length > 0 && ranked.quality > 0)
    .sort((left, right) => right.quality - left.quality);
}

/**
 * Guard: matching on the primary subtag alone is correct only because every
 * entry of `SUPPORTED_LOCALES` is a bare language subtag. Adding a locale that
 * carries a script or region (`zh-Hant`, `pt-BR`) makes this collapse `zh-Hans`
 * onto it, and the comparison has to become a real lookup at that point.
 *
 * The header ranks the languages the visitor reads. It says nothing about where
 * they are, and location is deliberately not an input.
 */
export function negotiateLocale(
  acceptLanguage: string | undefined,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  if (!acceptLanguage) {
    return fallback;
  }

  for (const { language } of rank(acceptLanguage)) {
    if (isLocale(language)) {
      return language;
    }
  }

  return fallback;
}
