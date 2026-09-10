import { z } from "zod";

export const webEnvSchema = z.object({
  VITE_CHAT_API_URL: z.url().default("http://127.0.0.1:5191"),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
