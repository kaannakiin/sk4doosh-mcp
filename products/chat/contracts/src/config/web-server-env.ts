import { z } from "zod";

/**
 * Guard: the render server needs an absolute origin of its own. The browser
 * reaches the api through a root-relative prefix, which has no origin for `fetch`
 * to resolve against in node — every server-side call through it throws before
 * it is sent. This is the api as the render process reaches it, which is not
 * necessarily the host the browser uses.
 */
export const webServerEnvSchema = z.object({
  CHAT_API_ORIGIN: z.url().default("http://127.0.0.1:5191"),
});

export type WebServerEnv = z.infer<typeof webServerEnvSchema>;
