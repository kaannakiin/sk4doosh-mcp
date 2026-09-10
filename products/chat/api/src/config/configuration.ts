import { apiEnvSchema } from "@chat/contracts/config/api-env";
import type { Locale } from "@chat/contracts/common/locale";

export interface AppConfig {
  port: number;
  defaultLocale: Locale;
  corsOrigin: string;
}

export function loadConfig(): AppConfig {
  const env = apiEnvSchema.parse(process.env);

  return {
    port: env.CHAT_API_PORT,
    defaultLocale: env.CHAT_DEFAULT_LOCALE,
    corsOrigin: env.CHAT_CORS_ORIGIN,
  };
}
