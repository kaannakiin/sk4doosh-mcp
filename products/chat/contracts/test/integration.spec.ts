import { describe, expect, it } from "vitest";

import {
  authorizeInvocation,
  type InvocationConnection,
  type InvocationIntegration,
} from "../src/integration/authorize-invocation.ts";
import { connectionSchema } from "../src/integration/connection.ts";
import { connectionScopeSchema } from "../src/integration/connection-scope.ts";
import {
  scopeMapConflicts,
  scopeRequirementFor,
} from "../src/integration/scope-map.ts";

const KAAN: string = "user-kaan";

const AYSE: string = "user-ayse";

const SYSTEMSOFT = "3f1b0c4e-0000-4000-8000-000000000001";

const OTHER_INTEGRATION = "3f1b0c4e-0000-4000-8000-000000000002";

const partner: InvocationIntegration = {
  id: SYSTEMSOFT,
  origin: "partner",
  scopeMap: {
    "orders.read": ["list_orders", "get_order"],
    "orders.manage": ["cancel_order"],
  },
};

const ownServer: InvocationIntegration = {
  id: SYSTEMSOFT,
  origin: "user",
  scopeMap: {},
};

function connectionOf(
  overrides: Partial<InvocationConnection<string>> = {},
): InvocationConnection<string> {
  return {
    id: "8a2c5d6f-0000-4000-8000-000000000001",
    ownerId: KAAN,
    integrationId: SYSTEMSOFT,
    status: "active",
    grantedScopes: ["orders.read"],
    ...overrides,
  };
}

describe("authorizeInvocation", () => {
  it("allows list_orders when the connection granted orders.read", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "list_orders",
      integration: partner,
      connection: connectionOf(),
    });

    expect(decision).toEqual({
      outcome: "allow",
      basis: "granted_scope",
      connectionId: "8a2c5d6f-0000-4000-8000-000000000001",
      integrationId: SYSTEMSOFT,
      scope: "orders.read",
    });
  });

  it("rejects cancel_order when the connection granted only orders.read", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "cancel_order",
      integration: partner,
      connection: connectionOf(),
    });

    expect(decision).toEqual({
      outcome: "deny",
      reason: "insufficient_connection_scope",
      detail: "scope_not_granted",
    });
  });

  it("denies a missing connection with connection_required", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "list_orders",
      integration: partner,
      connection: undefined,
    });

    expect(decision).toEqual({
      outcome: "deny",
      reason: "connection_required",
      detail: "connection_missing",
    });
  });

  it("denies a connection that belongs to another user with the same reason as one that does not exist", () => {
    const borrowed = authorizeInvocation({
      sessionUserId: AYSE,
      toolName: "list_orders",
      integration: partner,
      connection: connectionOf(),
    });
    const missing = authorizeInvocation({
      sessionUserId: AYSE,
      toolName: "list_orders",
      integration: partner,
      connection: undefined,
    });

    expect(borrowed).toMatchObject({
      outcome: "deny",
      reason: "connection_required",
    });
    expect(missing).toMatchObject({
      outcome: "deny",
      reason: "connection_required",
    });
  });

  it("separates a borrowed connection from a missing one in the audit detail only", () => {
    const decision = authorizeInvocation({
      sessionUserId: AYSE,
      toolName: "list_orders",
      integration: partner,
      connection: connectionOf(),
    });

    expect(decision).toEqual({
      outcome: "deny",
      reason: "connection_required",
      detail: "owner_mismatch",
    });
  });

  it("denies a connection whose integration is not the one the tool was resolved from", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "list_orders",
      integration: partner,
      connection: connectionOf({ integrationId: OTHER_INTEGRATION }),
    });

    expect(decision).toEqual({
      outcome: "deny",
      reason: "connection_required",
      detail: "integration_mismatch",
    });
  });

  it("denies a revoked connection whose granted scopes still cover the tool", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "list_orders",
      integration: partner,
      connection: connectionOf({ status: "revoked" }),
    });

    expect(decision).toEqual({
      outcome: "deny",
      reason: "connection_revoked",
      detail: "status_not_active",
    });
  });

  it("denies a connection awaiting re-consent with reauth_required", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "list_orders",
      integration: partner,
      connection: connectionOf({ status: "reauth_required" }),
    });

    expect(decision).toMatchObject({
      outcome: "deny",
      reason: "reauth_required",
    });
  });

  it("checks ownership before status, so a borrowed revoked connection reads as connection_required", () => {
    const decision = authorizeInvocation({
      sessionUserId: AYSE,
      toolName: "list_orders",
      integration: partner,
      connection: connectionOf({ status: "revoked" }),
    });

    expect(decision).toMatchObject({
      outcome: "deny",
      reason: "connection_required",
    });
  });

  it("checks status before scope, so a revoked connection never reports a scope problem", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "cancel_order",
      integration: partner,
      connection: connectionOf({ status: "revoked" }),
    });

    expect(decision).toMatchObject({
      outcome: "deny",
      reason: "connection_revoked",
    });
  });

  it("denies a partner tool that no scope lists, even when the connection granted every scope in the map", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "refund_order",
      integration: partner,
      connection: connectionOf({
        grantedScopes: ["orders.read", "orders.manage"],
      }),
    });

    expect(decision).toEqual({
      outcome: "deny",
      reason: "insufficient_connection_scope",
      detail: "tool_unmapped",
    });
  });

  it("denies a partner tool that two scopes list rather than choosing the narrower", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "get_order",
      integration: {
        ...partner,
        scopeMap: {
          "orders.read": ["get_order"],
          "orders.manage": ["get_order"],
        },
      },
      connection: connectionOf(),
    });

    expect(decision).toEqual({
      outcome: "deny",
      reason: "insufficient_connection_scope",
      detail: "tool_ambiguous",
    });
  });

  it("denies every tool of a partner integration whose scope map is empty", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "list_orders",
      integration: { ...partner, scopeMap: {} },
      connection: connectionOf(),
    });

    expect(decision).toMatchObject({
      outcome: "deny",
      reason: "insufficient_connection_scope",
    });
  });

  it("skips the scope check for a user-origin integration and allows on the connection alone", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "anything_at_all",
      integration: ownServer,
      connection: connectionOf({ grantedScopes: [] }),
    });

    expect(decision).toMatchObject({ outcome: "allow" });
  });

  it("reports basis connection_only, so an audit record cannot claim a scope was checked", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "anything_at_all",
      integration: ownServer,
      connection: connectionOf({ grantedScopes: [] }),
    });

    expect(decision).toEqual({
      outcome: "allow",
      basis: "connection_only",
      connectionId: "8a2c5d6f-0000-4000-8000-000000000001",
      integrationId: SYSTEMSOFT,
    });
  });

  it("denies a revoked user-origin connection exactly as it denies a revoked partner one", () => {
    const decision = authorizeInvocation({
      sessionUserId: KAAN,
      toolName: "anything_at_all",
      integration: ownServer,
      connection: connectionOf({ status: "revoked" }),
    });

    expect(decision).toMatchObject({
      outcome: "deny",
      reason: "connection_revoked",
    });
  });
});

describe("scopeRequirementFor", () => {
  it("resolves a tool exactly one scope lists", () => {
    expect(scopeRequirementFor(partner.scopeMap, "cancel_order")).toEqual({
      kind: "scope",
      scope: "orders.manage",
    });
  });

  it("reports a tool no scope lists as unmapped instead of resolving it", () => {
    expect(scopeRequirementFor(partner.scopeMap, "refund_order")).toEqual({
      kind: "unmapped",
    });
  });

  it("reports a tool two scopes list as ambiguous instead of choosing one", () => {
    expect(
      scopeRequirementFor(
        { "orders.read": ["get_order"], "orders.manage": ["get_order"] },
        "get_order",
      ),
    ).toEqual({
      kind: "ambiguous",
      scopes: ["orders.read", "orders.manage"],
    });
  });

  it("does not resolve __proto__ or constructor to a tool list", () => {
    expect(scopeRequirementFor(partner.scopeMap, "__proto__")).toEqual({
      kind: "unmapped",
    });
    expect(scopeRequirementFor(partner.scopeMap, "constructor")).toEqual({
      kind: "unmapped",
    });
  });
});

describe("scopeMapConflicts", () => {
  it("names every tool that two scopes list", () => {
    expect(
      scopeMapConflicts({
        "orders.read": ["get_order", "list_orders"],
        "orders.manage": ["get_order"],
      }),
    ).toEqual(["get_order"]);
  });

  it("does not report a tool a single scope lists twice", () => {
    expect(
      scopeMapConflicts({ "orders.read": ["get_order", "get_order"] }),
    ).toEqual([]);
  });

  it("names nothing for a map that partitions its tools", () => {
    expect(scopeMapConflicts(partner.scopeMap)).toEqual([]);
  });
});

describe("connection contracts", () => {
  it("rejects a scope token carrying a wildcard", () => {
    expect(connectionScopeSchema.safeParse("orders.*").success).toBe(false);
    expect(connectionScopeSchema.safeParse("orders").success).toBe(false);
    expect(connectionScopeSchema.safeParse("orders.read").success).toBe(true);
  });

  it("strips the owner and the provider subject from the wire projection", () => {
    const parsed = connectionSchema.parse({
      id: "8a2c5d6f-0000-4000-8000-000000000001",
      integrationId: SYSTEMSOFT,
      status: "active",
      createdAt: "2026-09-15T08:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
      ownerId: KAAN,
      providerSubject: "usr_887",
    });

    expect(parsed).not.toHaveProperty("ownerId");
    expect(parsed).not.toHaveProperty("providerSubject");
  });
});
