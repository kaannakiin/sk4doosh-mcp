import { SUPPORTED_LOCALES, isLocale, type Locale } from "@chat/contracts";
import Negotiator from "negotiator";

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
  if (explicit) {
    return explicit;
  }

  if (candidates.acceptLanguage) {
    const negotiated = new Negotiator({
      headers: { "accept-language": candidates.acceptLanguage },
    }).languages([...SUPPORTED_LOCALES]);
    const matched = negotiated.find(isLocale);
    if (matched) {
      return matched;
    }
  }

  return fallback;
}
