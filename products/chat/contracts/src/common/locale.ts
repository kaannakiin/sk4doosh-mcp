import { z } from "zod";

export const SUPPORTED_LOCALES = ["en", "tr"] as const;

export const DEFAULT_LOCALE = "en";

export const localeSchema = z.enum(SUPPORTED_LOCALES);

export type Locale = z.infer<typeof localeSchema>;

export function isLocale(value: unknown): value is Locale {
  return localeSchema.safeParse(value).success;
}
