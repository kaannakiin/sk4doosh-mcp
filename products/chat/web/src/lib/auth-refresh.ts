import type { Locale } from "@chat/contracts/common/locale";
import { AUTH_PATHS } from "@chat/queries/auth/path";

import { CREDENTIALS, chatEndpoint } from "./http";

const REFRESH_TIMEOUT_MS = 10_000;

/**
 * Guard: only these statuses prove the session is gone. A 500 or a dropped
 * connection says the api could not answer, not that the reader is signed out,
 * and latching on those signs someone out because their wifi blinked.
 */
const TERMINAL_STATUSES = new Set([401, 403, 422]);

let inFlight: Promise<boolean> | undefined;
let exhausted = false;
let onSessionLost: (() => void) | undefined;

export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

/** Clears the latch after a fresh sign-in mints a new session. */
export function resetSessionGuard(): void {
  exhausted = false;
}

/**
 * Tries to trade a still-valid refresh cookie for a session, from the sign-in
 * screen.
 *
 * Guard: the render can read the access cookie but not the refresh one, which is
 * scoped to the api subtree — so a reader coming back after the fifteen minute
 * access token lapsed is served the sign-in page even though their thirty day
 * session is intact. This is the one call that can see that cookie, and it is
 * why a morning reload does not cost a password.
 *
 * Guard: this probe never latches. It runs for genuinely anonymous visitors too,
 * whose 401 says nothing about a session they have not created yet; latching on
 * it would leave the real refresh disabled for the rest of the page's life.
 */
export async function recoverSession(locale: Locale): Promise<boolean> {
  return (await attempt(locale)).ok;
}

/**
 * Rotates the session cookies, at most once at a time.
 *
 * Guard: the promise is memoized, not its result. A sidebar list, an open
 * conversation and an in-flight upload all answer 401 the moment the fifteen
 * minute access cookie lapses; three rotations of the same refresh family make
 * the api treat a replayed generation as theft and revoke the whole session.
 * One flight, three awaiters, one rotation.
 *
 * @returns whether the caller may retry
 */
export function refreshSession(locale: Locale): Promise<boolean> {
  if (exhausted) {
    return Promise.resolve(false);
  }
  inFlight ??= rotate(locale).finally(() => {
    inFlight = undefined;
  });

  return inFlight;
}

async function rotate(locale: Locale): Promise<boolean> {
  const { ok, status } = await attempt(locale);
  if (ok) {
    return true;
  }
  if (status !== undefined && TERMINAL_STATUSES.has(status)) {
    exhausted = true;
    onSessionLost?.();
  }

  return false;
}

async function attempt(
  locale: Locale,
): Promise<{ ok: boolean; status?: number }> {
  try {
    /**
     * Guard: this is the one call whose entire purpose is to carry a cookie, so
     * it is the one that breaks first and most silently when the api is served
     * from its own host and the default `same-origin` mode withholds it.
     */
    const response = await fetch(chatEndpoint(AUTH_PATHS.refresh), {
      method: "POST",
      headers: { "x-locale": locale },
      credentials: CREDENTIALS,
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });

    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false };
  }
}
