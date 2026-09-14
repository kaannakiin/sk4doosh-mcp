import { chatKeys } from "@chat/queries/keys";
import { authKeys } from "@chat/queries/auth/keys";
import { createChatQueryClient } from "@chat/queries/query-client";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { setSessionLostHandler } from "./lib/auth-refresh";
import { internalHref } from "./lib/redirect-target";
import { routeTree } from "./routeTree.gen";

/**
 * Guard: the query client is built here, inside the per-request factory, rather
 * than at module scope. One server process renders for every visitor, and a
 * module-level client would serve one user's sessions to the next.
 */
export function getRouter() {
  const queryClient = createChatQueryClient();
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    context: { queryClient },
  });

  /**
   * Guard: this installs its own `QueryClientProvider` through `router.options.Wrap`,
   * so the root route must not mount a second one — two providers mean two
   * caches, and the identity the guard resolved on the server would be invisible
   * to the components reading it.
   */
  setupRouterSsrQueryIntegration({ router, queryClient });

  /**
   * Guard: the chat cache is dropped after the navigation resolves, not before.
   * Removing it first leaves the conversation components mounted and refetching
   * against a session that no longer exists, and each of those answers re-enters
   * this handler.
   */
  setSessionLostHandler(() => {
    queryClient.setQueryData(authKeys.currentUser(), null);
    const { href, pathname } = router.state.location;
    if (pathname.startsWith("/auth/")) {
      return;
    }
    void router
      .navigate({
        to: "/auth/login",
        search: { next: internalHref(href) },
        replace: true,
      })
      .then(() => {
        queryClient.removeQueries({ queryKey: chatKeys.all });
      });
  });

  return router;
}
