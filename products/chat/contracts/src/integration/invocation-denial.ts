import { z } from "zod";

/**
 * Guard: there is no `connection_expired` and no `provider_unavailable`. An
 * expired connection is `reauth_required`: both send the user to the same
 * reconnect step, so no caller could act on the difference. A provider outage
 * happens after this decision has returned `allow`, so a member for it would be
 * a case no exhaustive `switch` over this union can reach.
 */
export const invocationDenialReasonSchema = z.enum([
  "connection_required",
  "connection_revoked",
  "insufficient_connection_scope",
  "reauth_required",
]);

export type InvocationDenialReason = z.infer<
  typeof invocationDenialReasonSchema
>;

/**
 * Guard: the detail belongs to the audit record and never to a response body.
 * `connection_missing` and `owner_mismatch` share one reason on the wire, and a
 * caller that can tell them apart enumerates other users' connections one
 * request at a time.
 */
export const invocationDenialDetailSchema = z.enum([
  "connection_missing",
  "owner_mismatch",
  "integration_mismatch",
  "status_not_active",
  "tool_unmapped",
  "tool_ambiguous",
  "scope_not_granted",
]);

export type InvocationDenialDetail = z.infer<
  typeof invocationDenialDetailSchema
>;
