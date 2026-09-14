import { authKeys } from "@chat/queries/auth/keys";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { internalHref } from "~/lib/redirect-target";

/**
 * Guard: this sits outside the `/auth` layout, so it is a dispatcher rather than
 * a screen. Under the layout it would meet the inverse guard first, which sends
 * an already-authenticated visitor away — right for `success` by accident, wrong
 * for `profile_required`, and in both cases a decision made somewhere other than
 * where it reads.
 */
export const Route = createFileRoute("/auth_/callback")({
  validateSearch: (search: Record<string, unknown>) => ({
    auth:
      typeof search.auth === "string" ? search.auth : "oauth_state_invalid",
    next: internalHref(search.next),
  }),
  beforeLoad: async ({ context, search }) => {
    if (search.auth === "success") {
      /**
       * Guard: the identity cache is dropped, not refetched here. This is a
       * fresh document load after a round trip through the provider, so the
       * guard on the destination is the first thing to ask who this is.
       */
      context.queryClient.removeQueries({ queryKey: authKeys.currentUser() });

      throw redirect({ to: search.next ?? "/", replace: true });
    }
    if (search.auth === "profile_required") {
      throw redirect({
        to: "/auth/complete",
        search: { next: search.next },
        replace: true,
      });
    }

    throw redirect({
      to: "/auth/login",
      search: { next: search.next, notice: search.auth },
      replace: true,
    });
  },
});
