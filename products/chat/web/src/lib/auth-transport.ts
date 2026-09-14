import type { ChatClient } from "@chat/queries/client";
import { createIsomorphicFn } from "@tanstack/react-start";

import { chatClient } from "./chat-client";
import { serverChatClient } from "./server-transport";

/**
 * Picks the transport that can actually reach the api from where it runs.
 *
 * Guard: `createIsomorphicFn`, not a `typeof document` ternary. The plugin drops
 * the branch it does not need from each bundle, so `server-transport` — and the
 * `process.env` read inside it — never reaches the browser graph.
 */
export const authTransport = createIsomorphicFn()
  .client((): ChatClient => chatClient)
  .server((): ChatClient => serverChatClient);
