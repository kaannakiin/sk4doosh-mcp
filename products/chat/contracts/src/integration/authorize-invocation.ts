import type { ConnectionScope } from "./connection-scope.ts";
import type { ConnectionStatus } from "./connection-status.ts";
import type { ConnectionId } from "./connection.ts";
import type { IntegrationId, IntegrationOrigin } from "./integration.ts";
import type {
  InvocationDenialDetail,
  InvocationDenialReason,
} from "./invocation-denial.ts";
import type { RemoteToolName } from "./remote-tool-name.ts";
import { scopeRequirementFor, type IntegrationScopeMap } from "./scope-map.ts";

export interface InvocationIntegration {
  readonly id: IntegrationId;
  readonly origin: IntegrationOrigin;
  readonly scopeMap: IntegrationScopeMap;
}

export interface InvocationConnection<Owner extends string> {
  readonly id: ConnectionId;
  readonly ownerId: Owner;
  readonly integrationId: IntegrationId;
  readonly status: ConnectionStatus;
  readonly grantedScopes: readonly ConnectionScope[];
}

export interface InvocationRequest<Owner extends string> {
  readonly sessionUserId: Owner;
  readonly toolName: RemoteToolName;
  readonly integration: InvocationIntegration;
  readonly connection: InvocationConnection<NoInfer<Owner>> | undefined;
}

export type InvocationDecision =
  | {
      readonly outcome: "allow";
      readonly basis: "granted_scope";
      readonly connectionId: ConnectionId;
      readonly integrationId: IntegrationId;
      readonly scope: ConnectionScope;
    }
  | {
      readonly outcome: "allow";
      readonly basis: "connection_only";
      readonly connectionId: ConnectionId;
      readonly integrationId: IntegrationId;
    }
  | {
      readonly outcome: "deny";
      readonly reason: InvocationDenialReason;
      readonly detail: InvocationDenialDetail;
    };

type InactiveConnectionStatus = Exclude<ConnectionStatus, "active">;

/**
 * Guard: total over `ConnectionStatus` minus `active`, so a new status fails
 * the build here. A `switch` would return `undefined` for an unhandled case,
 * and an absent denial reason reads downstream as an allow.
 */
const REASON_BY_INACTIVE_STATUS: Record<
  InactiveConnectionStatus,
  InvocationDenialReason
> = {
  revoked: "connection_revoked",
  reauth_required: "reauth_required",
};

/**
 * Guard: total over `IntegrationOrigin`, so a third origin has to declare its
 * posture rather than inherit one by falling through.
 */
const STRATEGY_BY_ORIGIN: Record<
  IntegrationOrigin,
  "scope_map" | "connection_only"
> = {
  partner: "scope_map",
  user: "connection_only",
};

function deny(
  reason: InvocationDenialReason,
  detail: InvocationDenialDetail,
): InvocationDecision {
  return { outcome: "deny", reason, detail };
}

/**
 * Decides whether the authenticated user may invoke a remote tool over their
 * connection, before any credential is resolved and before any network call.
 *
 * Guard: `sessionUserId` comes from the trusted session and `ownerId` from the
 * loaded row; the two are compared here rather than left to the query's
 * `where`, so a repository that forgets to scope by owner still cannot
 * authorize a borrowed connection. A connection that exists under another
 * owner denies with the same reason as one that does not exist — a caller that
 * could tell them apart would enumerate other users' connections.
 *
 * Guard: the scope check is skipped for a `user` origin because no scope map
 * exists to check against. The branch is chosen by the stored `origin`, never
 * by the map being empty: an empty map is also what a partner integration looks
 * like when its manifest failed to load, and branching on emptiness would
 * authorize every tool on a real partner backend.
 *
 * @param request the trusted session subject, the requested tool, the
 * integration the tool was resolved from, and the connection loaded for that
 * subject and integration
 * @returns an allow naming the basis it was granted on, or a denial
 */
export function authorizeInvocation<Owner extends string>(
  request: InvocationRequest<Owner>,
): InvocationDecision {
  const { connection, integration } = request;

  if (connection === undefined) {
    return deny("connection_required", "connection_missing");
  }

  if (connection.ownerId !== request.sessionUserId) {
    return deny("connection_required", "owner_mismatch");
  }

  if (connection.integrationId !== integration.id) {
    return deny("connection_required", "integration_mismatch");
  }

  if (connection.status !== "active") {
    return deny(
      REASON_BY_INACTIVE_STATUS[connection.status],
      "status_not_active",
    );
  }

  if (STRATEGY_BY_ORIGIN[integration.origin] === "connection_only") {
    return {
      outcome: "allow",
      basis: "connection_only",
      connectionId: connection.id,
      integrationId: connection.integrationId,
    };
  }

  const requirement = scopeRequirementFor(
    integration.scopeMap,
    request.toolName,
  );

  if (requirement.kind === "unmapped") {
    return deny("insufficient_connection_scope", "tool_unmapped");
  }

  if (requirement.kind === "ambiguous") {
    return deny("insufficient_connection_scope", "tool_ambiguous");
  }

  if (!connection.grantedScopes.includes(requirement.scope)) {
    return deny("insufficient_connection_scope", "scope_not_granted");
  }

  return {
    outcome: "allow",
    basis: "granted_scope",
    connectionId: connection.id,
    integrationId: connection.integrationId,
    scope: requirement.scope,
  };
}
