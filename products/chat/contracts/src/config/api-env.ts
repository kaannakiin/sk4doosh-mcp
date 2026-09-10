import { z } from "zod";

import { DEFAULT_LOCALE, localeSchema } from "../common/locale.ts";

export const apiEnvSchema = z.object({
  CHAT_API_PORT: z.coerce.number().int().positive().default(5191),
  CHAT_DEFAULT_LOCALE: localeSchema.default(DEFAULT_LOCALE),
  CHAT_CORS_ORIGIN: z.url().default("http://localhost:5190"),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
