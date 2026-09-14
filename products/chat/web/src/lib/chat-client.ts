import type { ChatClient } from "@chat/queries/client";

import {
  CREDENTIALS,
  authFetch,
  chatEndpoint,
  request,
  requestNoContent,
} from "./http";

/**
 * Guard: `credentials` is set even though the dev server proxies the api under
 * this origin, where it changes nothing. `VITE_CHAT_API_URL` also accepts an
 * absolute url, and the AI SDK transport reads this field rather than the
 * wrapper's — leaving it unset makes the streaming turn the only call that drops
 * the session cookie on a separately hosted api.
 *
 * Guard: a separately hosted api is the degraded shape, not an equal one. The
 * session cookies then belong to that host, so the render server's forwarded
 * `cookie` header does not carry them and `hasSessionHint` cannot see the
 * marker — the first paint is anonymous and the recovery probe does not run.
 * Only the proxy shape renders a signed-in reader as signed in.
 */
export const chatClient: ChatClient = {
  request,
  requestNoContent,
  endpoint: chatEndpoint,
  fetch: authFetch,
  credentials: CREDENTIALS,
};
