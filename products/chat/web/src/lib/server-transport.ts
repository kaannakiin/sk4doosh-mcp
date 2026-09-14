import { webServerEnvSchema } from "@chat/contracts/config/web-server-env";
import type { ChatClient, ChatRequestInit } from "@chat/queries/client";
import { AUTH_PATHS } from "@chat/queries/auth/path";
import {
  getRequestHeader,
  getRequestUrl,
  getResponseHeaders,
  setResponseHeader,
} from "@tanstack/react-start/server";

import { unwrap } from "./api-response";
import { chatEndpoint } from "./http";

const SERVER_TIMEOUT_MS = 5_000;
const { CHAT_API_ORIGIN } = webServerEnvSchema.parse(process.env);

/**
 * Guard: `new URL(path, origin)` rather than string concatenation. It resolves
 * the root-relative default against the render server's own api origin while
 * leaving an absolute `VITE_CHAT_API_URL` untouched, so a deployment that serves
 * the api on its own host needs no second code path.
 */
function serverEndpoint(path: string): string {
  return new URL(chatEndpoint(path), CHAT_API_ORIGIN).toString();
}

/**
 * Guard: only the session lookup may trigger a rotation. A credential route
 * answers 401 for a wrong password, and refreshing there would rotate a
 * perfectly good session in response to a typo.
 */
function isRefreshable(path: string): boolean {
  return path === AUTH_PATHS.me;
}

function dispatch(
  path: string,
  init: ChatRequestInit,
  cookie: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "x-locale": init.locale,
    cookie,
  };
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  return fetch(serverEndpoint(path), {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
  });
}

/**
 * Rotates the session from inside the render, relaying the new cookies onward.
 *
 * @returns the cookie header to retry with, or `undefined` when nothing rotated
 */
async function refresh(cookie: string): Promise<string | undefined> {
  /**
   * Guard: `Origin` is written by hand. A browser attaches it to every unsafe
   * request but `fetch` in node does not, and `AuthOriginGuard` rejects an unsafe
   * request without an exactly matching one — the 403 that follows is
   * indistinguishable from an expired session, so the reader is signed out for a
   * header nobody sent.
   */
  const response = await fetch(serverEndpoint(AUTH_PATHS.refresh), {
    method: "POST",
    headers: { cookie, origin: getRequestUrl().origin },
    signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
  });
  if (!response.ok) {
    return undefined;
  }
  const issued = response.headers.getSetCookie();
  if (issued.length === 0) {
    return undefined;
  }
  relay(issued);

  return merge(cookie, issued);
}

/**
 * Guard: the rotated cookies are appended to whatever the response already
 * carries, never assigned over it. The locale and any cookie written earlier in
 * the render live in the same header, and replacing the list drops them.
 */
function relay(issued: readonly string[]): void {
  setResponseHeader("set-cookie", [
    ...getResponseHeaders().getSetCookie(),
    ...issued,
  ]);
}

/**
 * Guard: the retry has to carry the rotated values, not the ones the browser
 * sent. The old access token is exactly what produced the 401 being recovered
 * from, so replaying the original header just fails again.
 */
function merge(cookie: string, issued: readonly string[]): string {
  const pairs = new Map<string, string>();
  for (const pair of cookie.split(";")) {
    const trimmed = pair.trim();
    const separator = trimmed.indexOf("=");
    if (separator > 0) {
      pairs.set(trimmed.slice(0, separator), trimmed);
    }
  }
  for (const raw of issued) {
    const [pair = ""] = raw.split(";");
    const separator = pair.indexOf("=");
    if (separator > 0) {
      pairs.set(pair.slice(0, separator), pair.trim());
    }
  }

  return [...pairs.values()].join("; ");
}

async function send(path: string, init: ChatRequestInit): Promise<unknown> {
  /**
   * Guard: the browser's cookie header is forwarded by hand. The render server
   * is a second hop and its `fetch` has no cookie jar, so without this the render
   * decides every visitor is anonymous and bounces a signed-in reader to the
   * sign-in page on every cold load.
   */
  const cookie = getRequestHeader("cookie") ?? "";
  let response = await dispatch(path, init, cookie);

  if (response.status === 401 && isRefreshable(path)) {
    await response.body?.cancel();
    const rotated = await refresh(cookie);
    response = await dispatch(path, init, rotated ?? cookie);
  }

  return unwrap(response);
}

export const serverChatClient: ChatClient = {
  request: async (path, schema, init) => schema.parse(await send(path, init)),
  requestNoContent: async (path, init) => {
    await send(path, init);
  },
  endpoint: serverEndpoint,
};
