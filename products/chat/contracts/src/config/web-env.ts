import { z } from "zod";

/**
 * Guard: a root-relative prefix is accepted alongside an absolute URL, and it is
 * the default. The dev server proxies the api under its own origin so auth
 * cookies stay same-site and `SameSite=Lax` carries them. An absolute URL is
 * still legal for a deployment that serves the api on its own host, and is also
 * the only shape that works from a server-side render: a relative path has no
 * origin to resolve against, so every call through it must originate in the
 * browser. That shape additionally needs `CHAT_AUTH_COOKIE_SAMESITE=none` on the
 * api — a Lax cookie is withheld from every cross-site request, credentialed or
 * not — and it renders the first paint anonymous, because the cookies then
 * belong to the api's host rather than this one.
 */
const apiBaseSchema = z.union([
  z.url(),
  z.string().regex(/^\/[A-Za-z0-9\-._~/]*[A-Za-z0-9\-._~]$/u),
]);

export const webEnvSchema = z.object({
  VITE_CHAT_API_URL: apiBaseSchema.default("/api"),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
