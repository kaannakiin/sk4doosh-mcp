import { webServerEnvSchema } from "@chat/contracts/config/web-server-env";
import type { ChatClient, ChatRequestInit } from "@chat/queries/client";
import { getRequestHeader } from "@tanstack/react-start/server";

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

async function send(path: string, init: ChatRequestInit): Promise<unknown> {
  /**
   * Guard: the browser's cookie header is forwarded by hand. The render server
   * is a second hop and its `fetch` has no cookie jar, so without this the render
   * decides every visitor is anonymous and bounces a signed-in reader to the
   * sign-in page on every cold load.
   *
   * Guard: a 401 here is final, never answered with a rotation. `chat_refresh`
   * is scoped to the api's auth subtree, so a page request never carries it and
   * a refresh from the render can only fail — while spending a slot of the
   * refresh rate limit on every bounce. `useSessionRecovery` rotates from the
   * browser, the one hop that holds the cookie.
   */
  const cookie = getRequestHeader("cookie") ?? "";

  return unwrap(await dispatch(path, init, cookie));
}

export const serverChatClient: ChatClient = {
  request: async (path, schema, init) => schema.parse(await send(path, init)),
  requestNoContent: async (path, init) => {
    await send(path, init);
  },
  endpoint: serverEndpoint,
};
