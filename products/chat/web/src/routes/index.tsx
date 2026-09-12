import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Guard: a conversation's id is minted here and the visitor is moved onto it,
 * because the api has no create endpoint — it writes the row lazily while
 * reconciling the first turn. The id therefore has to exist before the server
 * has heard of it, and the url is what makes the conversation shareable,
 * reloadable and navigable with the back button.
 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({
      to: "/c/$sessionId",
      params: { sessionId: crypto.randomUUID() },
      replace: true,
    });
  },
});
