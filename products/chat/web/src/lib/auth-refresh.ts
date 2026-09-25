import type { Locale } from "@chat/contracts/common/locale";
import { AUTH_PATHS } from "@chat/queries/auth/path";

import { CREDENTIALS, chatEndpoint } from "./http";

const REFRESH_TIMEOUT_MS = 10_000;
const LOCK_WAIT_MS = 15_000;
const LOCK_NAME = "chat-session-refresh";
const ROTATED_AT_KEY = "chat:session-rotated-at";
const SUPERSEDED_STATUS = 409;

/**
 * Guard: only these statuses prove the session is gone. A 500 or a dropped
 * connection says the api could not answer, not that the reader is signed out,
 * and latching on those signs someone out because their wifi blinked.
 */
const TERMINAL_STATUSES = new Set([401, 403, 422]);

interface Outcome {
  readonly ok: boolean;
  readonly status?: number;
}

let inFlight: Promise<Outcome> | undefined;
let exhausted = false;
let epoch = 0;
let onSessionLost: (() => void) | undefined;

export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

/** Clears the latch after a fresh sign-in mints a new session. */
export function resetSessionGuard(): void {
  exhausted = false;
  epoch += 1;
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
 *
 * Guard: it joins the same flight as `refreshSession`. Two rotations of one
 * refresh token are a replay to the api, and a probe racing a 401 retry was
 * enough to revoke a healthy session.
 */
export async function recoverSession(locale: Locale): Promise<boolean> {
  return (await flight(locale)).ok;
}

/**
 * Waits out a rotation in flight and names the cookie generation a request is
 * about to carry.
 *
 * Guard: a request dispatched while a rotation is in flight carries the access
 * cookie that rotation is replacing, so it is guaranteed a 401 and a second
 * round trip. Holding it until the rotation settles sends it once, with the new
 * cookie.
 *
 * @returns the epoch to hand back to `refreshSession` if the request answers 401
 */
export async function sessionEpoch(): Promise<number> {
  await inFlight;

  return epoch;
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
 * Guard: a 401 from a request sent before the latest rotation proves nothing
 * about the new cookies. A slow response can land after the flight has already
 * settled, and rotating again for it burns a refresh generation and a slot of
 * the refresh rate limit to fix a request that only needs to be replayed.
 *
 * @param since the epoch `sessionEpoch` returned before the request was sent
 * @returns whether the caller may retry
 */
export async function refreshSession(
  locale: Locale,
  since: number,
): Promise<boolean> {
  if (exhausted) {
    return false;
  }
  if (since !== epoch) {
    return true;
  }
  const { ok, status } = await flight(locale);
  if (ok) {
    return true;
  }
  if (!exhausted && status !== undefined && TERMINAL_STATUSES.has(status)) {
    exhausted = true;
    onSessionLost?.();
  }

  return false;
}

function flight(locale: Locale): Promise<Outcome> {
  inFlight ??= acrossTabs(locale)
    .then((outcome) => {
      if (outcome.ok) {
        epoch += 1;
      }

      return outcome;
    })
    .finally(() => {
      inFlight = undefined;
    });

  return inFlight;
}

/**
 * Guard: the rotation is serialized across tabs, not only inside one. Every tab
 * shares the cookie jar but not `inFlight`, so two tabs meeting the same lapsed
 * access cookie would present one refresh token twice. A tab that waited on the
 * lock while another rotated skips its own rotation: the cookies it would trade
 * are already the new ones.
 *
 * Guard: `navigator.locks` is absent outside a secure context, so a plain-http
 * deployment falls back to the per-tab flight; the api's reuse grace is what
 * keeps that shape from revoking the session.
 */
async function acrossTabs(locale: Locale): Promise<Outcome> {
  if (typeof navigator === "undefined" || navigator.locks === undefined) {
    return attempt(locale);
  }
  const requestedAt = Date.now();
  try {
    return await navigator.locks.request(
      LOCK_NAME,
      { signal: AbortSignal.timeout(LOCK_WAIT_MS) },
      async () => {
        if (rotatedAt() > requestedAt) {
          return { ok: true };
        }
        const outcome = await attempt(locale);
        if (outcome.ok) {
          markRotated();
        }

        return outcome;
      },
    );
  } catch {
    return { ok: false };
  }
}

function rotatedAt(): number {
  try {
    return Number(localStorage.getItem(ROTATED_AT_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function markRotated(): void {
  try {
    localStorage.setItem(ROTATED_AT_KEY, String(Date.now()));
  } catch {
    return;
  }
}

async function attempt(locale: Locale): Promise<Outcome> {
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

    /**
     * Guard: 409 is success for the caller. The api answers it when a twin
     * request rotated this token a moment earlier, and that twin's answer has
     * already put the new cookies in this browser.
     */
    return {
      ok: response.ok || response.status === SUPERSEDED_STATUS,
      status: response.status,
    };
  } catch {
    return { ok: false };
  }
}
