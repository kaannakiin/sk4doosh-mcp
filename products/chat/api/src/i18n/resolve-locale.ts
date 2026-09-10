import { isLocale, type Locale } from "@chat/contracts/common/locale";
import { negotiateLocale } from "@chat/contracts/common/negotiate-locale";

export interface LocaleCandidates {
  query?: string | undefined;
  header?: string | undefined;
  acceptLanguage?: string | undefined;
}

export function resolveLocale(
  candidates: LocaleCandidates,
  fallback: Locale,
): Locale {
  const explicit = [candidates.query, candidates.header].find(isLocale);

  return explicit ?? negotiateLocale(candidates.acceptLanguage, fallback);
}
