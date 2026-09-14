import { currentUserOptions } from "@chat/queries/auth/current-user";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "~/components/app/AppShell";
import { authTransport } from "~/lib/auth-transport";
import { internalHref } from "~/lib/redirect-target";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(
      currentUserOptions(authTransport(), context.locale),
    );

    /**
     * Guard: the bounce carries the requested href, not the root. A reader
     * opening a bookmarked conversation with a lapsed cookie has to land back on
     * that conversation, or the deep link is worthless the one time it matters.
     */
    if (user === null) {
      throw redirect({
        to: "/auth/login",
        search: { next: internalHref(location.href) },
        replace: true,
      });
    }

    return { user };
  },
  component: AppShell,
});
