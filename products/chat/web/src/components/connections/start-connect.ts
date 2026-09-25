import { connectHref } from "@chat/queries/connections/path";

import { authTransport } from "~/lib/auth-transport";

/**
 * Guard: a full page assignment, not a router navigation. The api answers this
 * url with a `302` to the authorization server, which is a different origin —
 * the router would try to resolve it as an internal route and go nowhere.
 */
export function startConnect(integrationId: string): void {
  window.location.assign(connectHref(authTransport(), integrationId));
}
