import { isConnectionOutcome } from "@chat/contracts/integration/connect";
import { connectionKeys } from "@chat/queries/connections/keys";
import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Where the api sends the browser after an authorization, whatever the outcome.
 *
 * Guard: no component. The route's whole job is to invalidate the list and hand
 * the reader back to the page they left; rendering anything here would put a
 * screen in front of them that they have to dismiss.
 *
 * Guard: `status` is classified, not carried. The api only ever sends a member
 * of the closed vocabulary, but this url is one a reader can type — and an
 * unclassified string rendered on the integrations page would make that closed
 * vocabulary enforce nothing.
 */
export const Route = createFileRoute("/_authenticated/connections/callback")({
  validateSearch: (search: Record<string, unknown>) => ({
    notice: isConnectionOutcome(search.status)
      ? search.status
      : ("connection_failed" as const),
  }),
  beforeLoad: ({ context, search }) => {
    void context.queryClient.invalidateQueries({
      queryKey: connectionKeys.integrations(),
    });

    throw redirect({
      to: "/connections",
      search: { notice: search.notice },
      replace: true,
    });
  },
});
