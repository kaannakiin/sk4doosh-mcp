import type { ChatClient } from "@chat/queries/client";

import { chatEndpoint, request, requestNoContent } from "./http";

/**
 * Guard: neither `credentials` nor `authHeaders` is set, and that is the point.
 * The dev server proxies the api under this origin so the httpOnly `chat_owner`
 * cookie rides along under `SameSite=Lax`. Naming a credentials mode here is the
 * first step toward the cross-origin setup that drops the cookie on plain http
 * and mints a fresh owner on every request.
 */
export const chatClient: ChatClient = {
  request,
  requestNoContent,
  endpoint: chatEndpoint,
};
