import { z } from "zod";

/**
 * Guard: a root-relative prefix is accepted alongside an absolute URL, and it is
 * the default. The dev server proxies the api under its own origin so the owner
 * cookie stays same-site — `SameSite=Lax` then carries it, and no fetch has to
 * opt into `credentials`. An absolute URL is still legal for a deployment that
 * serves the api on its own host, which is also the only shape that works from a
 * server-side render: a relative path has no origin to resolve against, so every
 * call through it must originate in the browser.
 */
const apiBaseSchema = z.union([
  z.url(),
  z.string().regex(/^\/[A-Za-z0-9\-._~/]*[A-Za-z0-9\-._~]$/u),
]);

export const webEnvSchema = z.object({
  VITE_CHAT_API_URL: apiBaseSchema.default("/api"),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
