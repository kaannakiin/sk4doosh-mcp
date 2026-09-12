import { createChatQueryClient } from "@chat/queries/query-client";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

/**
 * Guard: the query client is built here, inside the per-request factory, rather
 * than at module scope. One server process renders for every visitor, and a
 * module-level client would serve one owner's sessions to the next.
 */
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    context: { queryClient: createChatQueryClient() },
  });
}
