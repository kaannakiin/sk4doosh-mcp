export const INTEGRATION_PATHS = {
  root: "/integrations",
} as const;

export function integrationPath(integrationId: string, suffix = ""): string {
  return `${INTEGRATION_PATHS.root}/${encodeURIComponent(integrationId)}${suffix}`;
}

/**
 * Where the browser is sent to begin an authorization.
 *
 * Guard: this is a navigation target, never a request path. The endpoint's whole
 * job is to answer `302` to the authorization server, and a redirect followed
 * inside `fetch` never reaches the address bar — the reader would sit on a page
 * that silently did nothing.
 *
 * @param client the transport, for the absolute origin the api answers on
 * @param integrationId the integration to connect
 * @returns an absolute url to assign to `window.location`
 */
export function connectHref(
  client: { endpoint(path: string): string },
  integrationId: string,
): string {
  return client.endpoint(
    `/connections/${encodeURIComponent(integrationId)}/connect`,
  );
}
