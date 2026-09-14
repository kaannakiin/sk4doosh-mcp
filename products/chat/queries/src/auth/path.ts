export const AUTH_PATHS = {
  me: "/auth/me",
  registerEmail: "/auth/register/email",
  registerPhone: "/auth/register/phone",
  verificationRequest: "/auth/verification/request",
  verificationResend: "/auth/verification/resend",
  verificationConfirm: "/auth/verification/confirm",
  loginPassword: "/auth/login/password",
  phoneLoginRequest: "/auth/login/phone/request",
  phoneLoginConfirm: "/auth/login/phone/confirm",
  oauthComplete: "/auth/oauth/complete",
  refresh: "/auth/refresh",
  logout: "/auth/logout",
} as const;

/**
 * Builds the url a provider sign-in has to be navigated to.
 *
 * Guard: a real navigation, never a fetch. The route answers 302 to the
 * provider, and neither `fetch` nor the AI SDK transport can hand a
 * cross-origin redirect to the browser's address bar.
 */
export function oauthStartPath(
  provider: string,
  intent: "login" | "link" = "login",
): string {
  return `/auth/oauth/${encodeURIComponent(provider)}/start?intent=${intent}`;
}
