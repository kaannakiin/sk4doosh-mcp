export const INTEGRATION_PATHS = {
  root: "/integrations",
  approvals: "/tool-approvals",
} as const;

export function integrationPath(integrationId: string, suffix = ""): string {
  return `${INTEGRATION_PATHS.root}/${encodeURIComponent(integrationId)}${suffix}`;
}

/**
 * Guard: an approval is addressed by the name the model was offered the tool
 * under, not by an integration and a tool name. The approval part the AI SDK
 * renders carries only that name, so it is the one identifier the browser holds
 * — the api resolves it back to a row.
 *
 * @param exposedName the tool name as it appears on the approval prompt
 * @returns the path of that one remembered approval
 */
export function toolApprovalPath(exposedName: string): string {
  return `${INTEGRATION_PATHS.approvals}/${encodeURIComponent(exposedName)}`;
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
