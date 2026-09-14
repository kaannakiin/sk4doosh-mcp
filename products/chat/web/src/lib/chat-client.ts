import type { ChatClient } from "@chat/queries/client";

import { chatEndpoint, request, requestNoContent } from "./http";

/**
 * Guard: the dev server proxies the api under this origin, so the browser sends
 * the HttpOnly auth cookies without a cross-origin credentials mode.
 */
export const chatClient: ChatClient = {
  request,
  requestNoContent,
  endpoint: chatEndpoint,
};
