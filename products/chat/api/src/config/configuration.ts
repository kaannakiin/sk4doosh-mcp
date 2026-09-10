import { DEFAULT_LOCALE, localeSchema, type Locale } from "@chat/contracts";
import { z } from "zod";

const envSchema = z.object({
  CHAT_API_PORT: z.coerce.number().int().positive().default(5191),
  CHAT_DEFAULT_LOCALE: localeSchema.default(DEFAULT_LOCALE),
  CHAT_CORS_ORIGIN: z.url().default("http://localhost:5190"),
});

export interface AppConfig {
  port: number;
  defaultLocale: Locale;
  corsOrigin: string;
}

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);

  return {
    port: env.CHAT_API_PORT,
    defaultLocale: env.CHAT_DEFAULT_LOCALE,
    corsOrigin: env.CHAT_CORS_ORIGIN,
  };
}
