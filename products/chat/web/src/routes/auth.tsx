import { currentUserOptions } from "@chat/queries/auth/current-user";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthLayout } from "~/components/auth/AuthLayout";
import { authTransport } from "~/lib/auth-transport";
import { internalHref } from "~/lib/redirect-target";

export interface AuthSearch {
  readonly next?: string | undefined;
  readonly notice?: string | undefined;
}

export const Route = createFileRoute("/auth")({
  /**
   * Guard: `next` is narrowed on every parse rather than at the navigate site.
   * `validateSearch` runs before any component reads it, so a hostile
   * `?next=https://evil.example` is already gone by the time the sign-in form
   * decides where to send a freshly authenticated reader.
   */
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    next: internalHref(search.next),
    notice: typeof search.notice === "string" ? search.notice : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const user = await context.queryClient.ensureQueryData(
      currentUserOptions(authTransport(), context.locale),
    );
    if (user !== null) {
      throw redirect({ to: search.next ?? "/", replace: true });
    }
  },
  component: AuthLayout,
});
