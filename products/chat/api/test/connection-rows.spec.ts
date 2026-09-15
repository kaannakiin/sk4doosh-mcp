import { authorizeInvocation } from "@chat/contracts/integration/authorize-invocation";
import { describe, expect, it } from "vitest";

import type { UserId } from "../src/db/ids.ts";
import {
  toInvocationContext,
  toScopeMap,
} from "../src/connections/connection-rows.ts";

const KAAN = 42n;

const AYSE = 43n;

const INTEGRATION = "3f1b0c4e-0000-4000-8000-000000000001";

const CONNECTION = "8a2c5d6f-0000-4000-8000-000000000001";

const toolScopes = [
  { toolName: "list_orders", scope: "orders.read" },
  { toolName: "get_order", scope: "orders.read" },
  { toolName: "cancel_order", scope: "orders.manage" },
];

function integrationRow(
  connections: readonly {
    publicId: string;
    userId: bigint;
    status: "active" | "revoked" | "reauth_required";
    scopes: readonly { scope: string }[];
  }[],
) {
  return {
    publicId: INTEGRATION,
    origin: "partner" as const,
    toolScopes,
    connections,
  };
}

describe("toScopeMap", () => {
  it("groups every tool under the scope that lists it", () => {
    expect(toScopeMap(toolScopes)).toEqual({
      "orders.read": ["list_orders", "get_order"],
      "orders.manage": ["cancel_order"],
    });
  });

  it("returns an empty map for an integration that published none", () => {
    expect(toScopeMap([])).toEqual({});
  });

  it("keeps a scope named __proto__ as an own property rather than a prototype", () => {
    const map = toScopeMap([{ toolName: "list_orders", scope: "__proto__" }]);

    expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    expect(Object.hasOwn(map, "__proto__")).toBe(true);
  });
});

describe("toInvocationContext", () => {
  it("reports no connection when the user has not connected", () => {
    const context = toInvocationContext(integrationRow([]));

    expect(context.connection).toBeUndefined();
    expect(context.integration).toEqual({
      id: INTEGRATION,
      origin: "partner",
      scopeMap: {
        "orders.read": ["list_orders", "get_order"],
        "orders.manage": ["cancel_order"],
      },
    });
  });

  it("carries the owner the row names, so the authorizer compares against stored state", () => {
    const context = toInvocationContext(
      integrationRow([
        {
          publicId: CONNECTION,
          userId: AYSE,
          status: "active",
          scopes: [{ scope: "orders.read" }],
        },
      ]),
    );

    expect(context.connection?.ownerId).toBe("43");
  });

  it("projects the granted scopes a connection carries", () => {
    const context = toInvocationContext(
      integrationRow([
        {
          publicId: CONNECTION,
          userId: KAAN,
          status: "active",
          scopes: [{ scope: "orders.read" }, { scope: "orders.manage" }],
        },
      ]),
    );

    expect(context.connection).toEqual({
      id: CONNECTION,
      ownerId: "42",
      integrationId: INTEGRATION,
      status: "active",
      grantedScopes: ["orders.read", "orders.manage"],
    });
  });
});

describe("the repository output against the authorizer", () => {
  const kaan = "42" as UserId;

  function decide(
    userId: UserId,
    toolName: string,
    connections: Parameters<typeof integrationRow>[0],
  ) {
    const context = toInvocationContext(integrationRow(connections));

    return authorizeInvocation({
      sessionUserId: userId,
      toolName,
      integration: context.integration,
      connection: context.connection,
    });
  }

  const connected = [
    {
      publicId: CONNECTION,
      userId: KAAN,
      status: "active" as const,
      scopes: [{ scope: "orders.read" }],
    },
  ];

  it("allows a tool the stored scopes cover", () => {
    expect(decide(kaan, "list_orders", connected)).toMatchObject({
      outcome: "allow",
      basis: "granted_scope",
      scope: "orders.read",
    });
  });

  it("denies a tool the stored scopes do not cover", () => {
    expect(decide(kaan, "cancel_order", connected)).toMatchObject({
      outcome: "deny",
      reason: "insufficient_connection_scope",
    });
  });

  it("denies when the stored row names a different owner", () => {
    const borrowed = [{ ...connected[0]!, userId: AYSE }];

    expect(decide(kaan, "list_orders", borrowed)).toMatchObject({
      outcome: "deny",
      reason: "connection_required",
      detail: "owner_mismatch",
    });
  });

  it("denies when the user has no connection at all", () => {
    expect(decide(kaan, "list_orders", [])).toMatchObject({
      outcome: "deny",
      reason: "connection_required",
      detail: "connection_missing",
    });
  });
});
