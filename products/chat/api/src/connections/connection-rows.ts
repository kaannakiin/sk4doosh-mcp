import type {
  InvocationConnection,
  InvocationIntegration,
} from "@chat/contracts/integration/authorize-invocation";
import type { ConnectionStatus } from "@chat/contracts/integration/connection-status";
import type {
  IntegrationId,
  IntegrationOrigin,
} from "@chat/contracts/integration/integration";
import type { IntegrationScopeMap } from "@chat/contracts/integration/scope-map";

import type { UserId } from "../db/ids.ts";

interface ToolScopeShape {
  readonly toolName: string;
  readonly scope: string;
}

interface ConnectionShape {
  readonly publicId: string;
  readonly userId: bigint;
  readonly status: ConnectionStatus;
  readonly scopes: readonly { readonly scope: string }[];
}

interface IntegrationShape {
  readonly publicId: string;
  readonly origin: IntegrationOrigin;
  readonly toolScopes: readonly ToolScopeShape[];
  readonly connections: readonly ConnectionShape[];
}

export interface InvocationContext {
  readonly integration: InvocationIntegration;
  readonly connection: InvocationConnection<UserId> | undefined;
}

/**
 * The rows a user may see: every partner integration, plus the ones they added.
 *
 * Guard: one definition, called by every path that resolves an integration by
 * its public id. A path that filtered differently would let a caller naming a
 * `user` integration they do not own learn that it exists, which is the whole of
 * what a private server's registration discloses.
 *
 * @param userId the subject of the trusted session
 * @param integrationId the public id to narrow to, when there is one
 * @returns a Prisma `where` over `Integration`
 */
export function visibleToUser(userId: UserId, integrationId?: IntegrationId) {
  return {
    ...(integrationId === undefined ? {} : { publicId: integrationId }),
    status: "active" as const,
    OR: [{ origin: "partner" as const }, { ownerId: BigInt(userId) }],
  };
}

/**
 * Guard: the map is assembled through a `Map` rather than by indexing a plain
 * object, so a scope named `__proto__` cannot reach the object's prototype. The
 * column's shape constraint already forbids that name; this keeps the mapper
 * correct on its own, without depending on the constraint being present.
 */
export function toScopeMap(
  rows: readonly ToolScopeShape[],
): IntegrationScopeMap {
  const grouped = new Map<string, string[]>();
  for (const { scope, toolName } of rows) {
    const tools = grouped.get(scope);
    if (tools === undefined) {
      grouped.set(scope, [toolName]);
    } else {
      tools.push(toolName);
    }
  }

  return Object.fromEntries(grouped);
}

/**
 * Guard: `ownerId` is read from the connection row rather than echoed from the
 * caller's own identity. The query already filters by owner, so echoing it would
 * make the authorizer's ownership comparison compare a value against itself and
 * pass unconditionally — the check exists to catch a query that stopped
 * filtering, and it can only do that against what the row actually says.
 */
export function toInvocationContext(row: IntegrationShape): InvocationContext {
  const [connection] = row.connections;
  const integration: InvocationIntegration = {
    id: row.publicId,
    origin: row.origin,
    scopeMap: toScopeMap(row.toolScopes),
  };

  if (connection === undefined) {
    return { integration, connection: undefined };
  }

  return {
    integration,
    connection: {
      id: connection.publicId,
      ownerId: connection.userId.toString() as UserId,
      integrationId: row.publicId,
      status: connection.status,
      grantedScopes: connection.scopes.map(({ scope }) => scope),
    },
  };
}
