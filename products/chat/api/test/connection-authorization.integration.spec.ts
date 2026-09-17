import type { ConfigService } from "@nestjs/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config/configuration.ts";
import { AuthorizationDiscoveryService } from "../src/connections/authorization-discovery.service.ts";
import { ClientRegistrationService } from "../src/connections/client-registration.service.ts";
import { ConnectionAttemptRepository } from "../src/connections/connection-attempt.repository.ts";
import { ConnectionAuthorizationService } from "../src/connections/connection-authorization.service.ts";
import { ConnectionRepository } from "../src/connections/connection.repository.ts";
import { CredentialCipherService } from "../src/connections/credential-cipher.service.ts";
import { IntegrationAuthorizationRepository } from "../src/connections/integration-authorization.repository.ts";
import { IntegrationRepository } from "../src/connections/integration.repository.ts";
import { IntegrationAuthorizationService } from "../src/connections/integration-authorization.service.ts";
import { DbService } from "../src/db/db.service.ts";
import type { UserId } from "../src/db/ids.ts";
import { json, startStub, type Stub, type StubCall } from "./oauth-stub.ts";

const url = process.env.CHAT_TEST_DATABASE_URL;

const withDatabase = url === undefined ? describe.skip : describe;

const SECRET = Buffer.alloc(32, 41).toString("base64");

const CALLBACK = "http://127.0.0.1:5191/api/connections/callback";

function configFor(databaseUrl: string): ConfigService<AppConfig, true> {
  const values: Record<string, unknown> = {
    environment: "development",
    pathPrefix: "/api",
    auth: { publicApiUrl: "http://127.0.0.1:5191" },
    "auth.secret": SECRET,
    database: { url: databaseUrl, poolMax: 2 },
  };

  return {
    get: (key: string): unknown => values[key],
  } as unknown as ConfigService<AppConfig, true>;
}

withDatabase("ConnectionAuthorizationService", () => {
  const config = configFor(url ?? "");
  let db: DbService;
  let cipher: CredentialCipherService;
  let connections: ConnectionRepository;
  let service: ConnectionAuthorizationService;
  let stub: Stub | undefined;
  let tokenCalls: StubCall[] = [];
  const integrations: bigint[] = [];
  const users: bigint[] = [];

  beforeAll(() => {
    db = new DbService(config);
    cipher = new CredentialCipherService(config);
    connections = new ConnectionRepository(db);
    const authorizations = new IntegrationAuthorizationRepository(db);
    service = new ConnectionAuthorizationService(
      new IntegrationAuthorizationService(
        new AuthorizationDiscoveryService(config),
        new ClientRegistrationService(config),
        authorizations,
        cipher,
      ),
      new ConnectionAttemptRepository(db),
      connections,
      new IntegrationRepository(db),
      cipher,
      config,
    );
  });

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
    tokenCalls = [];
    if (integrations.length > 0) {
      await db.client.integration.deleteMany({
        where: { id: { in: integrations.splice(0) } },
      });
    }
    if (users.length > 0) {
      await db.client.user.deleteMany({
        where: { id: { in: users.splice(0) } },
      });
    }
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  let grantedScope: string | undefined = "orders.read";

  async function authorizationServer(): Promise<Stub> {
    stub = await startStub((call, origin) => {
      const [path] = call.path.split("?");

      if (path === "/mcp") {
        return {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
          },
        };
      }

      if (path === "/.well-known/oauth-protected-resource/mcp") {
        return json({
          resource: `${origin}/mcp`,
          authorization_servers: [`${origin}/`],
          scopes_supported: ["orders.read"],
        });
      }

      if (path === "/.well-known/oauth-authorization-server") {
        return json({
          issuer: `${origin}/`,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          code_challenge_methods_supported: ["S256"],
        });
      }

      if (path === "/register") {
        return json(
          {
            client_id: "cid-flow",
            client_secret: "flow-secret",
            client_secret_expires_at: 0,
            token_endpoint_auth_method: "client_secret_basic",
          },
          201,
        );
      }

      if (path === "/token") {
        tokenCalls.push(call);

        return json({
          access_token: "at-flow",
          refresh_token: "rt-flow",
          token_type: "Bearer",
          expires_in: 3600,
          ...(grantedScope === undefined ? {} : { scope: grantedScope }),
        });
      }

      return { status: 404 };
    });

    return stub;
  }

  async function subject(): Promise<{
    userId: UserId;
    userRowId: bigint;
    integrationId: string;
    integrationRowId: bigint;
    mcpUrl: string;
  }> {
    const origin = (await authorizationServer()).origin;
    const user = await db.client.user.create({
      data: { firstName: "Kaan", lastName: "Akın" },
    });
    users.push(user.id);
    const integration = await db.client.integration.create({
      data: {
        origin: "partner",
        displayName: "Motokurye",
        mcpUrl: `${origin}/mcp`,
        toolScopes: {
          create: [{ toolName: "orders_me", scope: "orders.read" }],
        },
      },
    });
    integrations.push(integration.id);

    return {
      userId: user.id.toString() as UserId,
      userRowId: user.id,
      integrationId: integration.publicId,
      integrationRowId: integration.id,
      mcpUrl: `${origin}/mcp`,
    };
  }

  function stateOf(authorizationUrl: string): string {
    return new URL(authorizationUrl).searchParams.get("state") ?? "";
  }

  it("sends the owner away with PKCE, the resource and the mapped scope", async () => {
    const it0 = await subject();
    const started = await service.start(it0.userId, it0.integrationId);

    expect(started.kind).toBe("redirect");
    if (started.kind !== "redirect") {
      return;
    }

    const parameters = new URL(started.url).searchParams;

    expect(parameters.get("response_type")).toBe("code");
    expect(parameters.get("client_id")).toBe("cid-flow");
    expect(parameters.get("redirect_uri")).toBe(CALLBACK);
    expect(parameters.get("code_challenge_method")).toBe("S256");
    expect(parameters.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(parameters.get("resource")).toBe(it0.mcpUrl);
    expect(parameters.get("scope")).toBe("orders.read");
  });

  it("does not let an integration the caller cannot see start an attempt", async () => {
    const owner = await db.client.user.create({
      data: { firstName: "Ada", lastName: "Byron" },
    });
    users.push(owner.id);
    const stranger = await db.client.user.create({
      data: { firstName: "Kaan", lastName: "Akın" },
    });
    users.push(stranger.id);
    const hidden = await db.client.integration.create({
      data: {
        origin: "user",
        ownerId: owner.id,
        displayName: "Private",
        mcpUrl: "https://private.example/mcp",
      },
    });
    integrations.push(hidden.id);

    await expect(
      service.start(stranger.id.toString() as UserId, hidden.publicId),
    ).resolves.toEqual({
      kind: "refused",
      outcome: "integration_unavailable",
    });
  });

  it("exchanges the code and stores tokens only it can open", async () => {
    const it0 = await subject();
    const started = await service.start(it0.userId, it0.integrationId);
    if (started.kind !== "redirect") {
      throw new Error("the attempt did not start");
    }

    await expect(
      service.complete(
        { state: stateOf(started.url), code: "auth-code-1" },
        it0.userId,
      ),
    ).resolves.toBe("connected");

    const sent = new URLSearchParams(tokenCalls[0]?.body ?? "");

    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("auth-code-1");
    expect(sent.get("redirect_uri")).toBe(CALLBACK);
    expect(sent.get("resource")).toBe(it0.mcpUrl);
    expect(sent.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const row = await db.client.connection.findUniqueOrThrow({
      where: {
        userId_integrationId: {
          userId: it0.userRowId,
          integrationId: it0.integrationRowId,
        },
      },
      omit: { accessToken: false, refreshToken: false },
    });

    expect(row.status).toBe("active");
    expect(row.providerScope).toBe("orders.read");
    expect(row.accessToken).not.toContain("at-flow");
    await expect(
      cipher.open(row.publicId, "access_token", row.accessToken ?? ""),
    ).resolves.toBe("at-flow");
    await expect(
      cipher.open(row.publicId, "refresh_token", row.refreshToken ?? ""),
    ).resolves.toBe("rt-flow");

    /**
     * Guard: the access token's ciphertext must not open as the refresh token's.
     * Both sit on one row, so a header bound only to the row would let one be
     * copied into the other's column and still decrypt.
     */
    await expect(
      cipher.open(row.publicId, "refresh_token", row.accessToken ?? ""),
    ).resolves.toBeUndefined();
  });

  /**
   * Guard: `connection_provider_scope_check` refuses a scope shorter than one
   * character. A server that granted nothing in particular may echo `scope: ""`,
   * and storing that verbatim turned a successful grant into a constraint
   * violation — which reached the reader as "the connection could not be
   * completed" with the token already exchanged.
   */
  it("stores a connection whose server echoed an empty scope", async () => {
    grantedScope = "";
    try {
      const it0 = await subject();
      const started = await service.start(it0.userId, it0.integrationId);
      if (started.kind !== "redirect") {
        throw new Error("the attempt did not start");
      }

      await expect(
        service.complete(
          { state: stateOf(started.url), code: "auth-code-blank" },
          it0.userId,
        ),
      ).resolves.toBe("connected");

      const row = await db.client.connection.findUniqueOrThrow({
        where: {
          userId_integrationId: {
            userId: it0.userRowId,
            integrationId: it0.integrationRowId,
          },
        },
      });

      expect(row.status).toBe("active");
      expect(row.providerScope).toBeNull();
    } finally {
      grantedScope = "orders.read";
    }
  });

  /**
   * Guard: what the server granted is bookkeeping, and recording it can never
   * fail the grant. A provider asked for broad access answers with every scope
   * it granted in one list — `https://mcp.cloudflare.com` exceeds what the
   * column accepts — and the write that completed an authorization the user had
   * already consented to was being refused because of it.
   */
  it("stores a connection whose server granted more scope than the column holds", async () => {
    grantedScope = `${"scope:read ".repeat(1000)}last:one`;
    try {
      const it0 = await subject();
      const started = await service.start(it0.userId, it0.integrationId);
      if (started.kind !== "redirect") {
        throw new Error("the attempt did not start");
      }

      await expect(
        service.complete(
          { state: stateOf(started.url), code: "auth-code-wide" },
          it0.userId,
        ),
      ).resolves.toBe("connected");

      const row = await db.client.connection.findUniqueOrThrow({
        where: {
          userId_integrationId: {
            userId: it0.userRowId,
            integrationId: it0.integrationRowId,
          },
        },
      });

      expect(row.status).toBe("active");
      expect(row.providerScope).toBeNull();
    } finally {
      grantedScope = "orders.read";
    }
  });

  it("records a long grant the column can still hold", async () => {
    grantedScope = `${"scope:read ".repeat(200)}last:one`;
    try {
      const it0 = await subject();
      const started = await service.start(it0.userId, it0.integrationId);
      if (started.kind !== "redirect") {
        throw new Error("the attempt did not start");
      }

      await expect(
        service.complete(
          { state: stateOf(started.url), code: "auth-code-long" },
          it0.userId,
        ),
      ).resolves.toBe("connected");

      const row = await db.client.connection.findUniqueOrThrow({
        where: {
          userId_integrationId: {
            userId: it0.userRowId,
            integrationId: it0.integrationRowId,
          },
        },
      });

      expect(row.providerScope).toBe(grantedScope);
    } finally {
      grantedScope = "orders.read";
    }
  });

  it("refuses a second callback carrying the same state", async () => {
    const it0 = await subject();
    const started = await service.start(it0.userId, it0.integrationId);
    if (started.kind !== "redirect") {
      throw new Error("the attempt did not start");
    }

    const state = stateOf(started.url);
    await service.complete({ state, code: "auth-code-1" }, it0.userId);

    await expect(
      service.complete({ state, code: "auth-code-1" }, it0.userId),
    ).resolves.toBe("attempt_invalid");
    expect(tokenCalls).toHaveLength(1);
  });

  it("refuses a callback that arrives on another user's session", async () => {
    const it0 = await subject();
    const other = await db.client.user.create({
      data: { firstName: "Ada", lastName: "Byron" },
    });
    users.push(other.id);
    const started = await service.start(it0.userId, it0.integrationId);
    if (started.kind !== "redirect") {
      throw new Error("the attempt did not start");
    }

    await expect(
      service.complete(
        { state: stateOf(started.url), code: "auth-code-1" },
        other.id.toString() as UserId,
      ),
    ).resolves.toBe("attempt_invalid");
    expect(tokenCalls).toHaveLength(0);
  });

  /**
   * Guard: RFC 9207. A code minted by one authorization server presented to
   * another's token endpoint is the mix-up attack the `iss` parameter exists to
   * stop.
   */
  it("refuses a callback whose issuer disagrees with the snapshot", async () => {
    const it0 = await subject();
    const started = await service.start(it0.userId, it0.integrationId);
    if (started.kind !== "redirect") {
      throw new Error("the attempt did not start");
    }

    await expect(
      service.complete(
        {
          state: stateOf(started.url),
          code: "auth-code-1",
          iss: "https://elsewhere.example/",
        },
        it0.userId,
      ),
    ).resolves.toBe("attempt_invalid");
    expect(tokenCalls).toHaveLength(0);
  });

  it("reports a refusal at the authorization server as a denial", async () => {
    const it0 = await subject();

    await expect(
      service.complete(
        { state: "whatever", error: "access_denied" },
        it0.userId,
      ),
    ).resolves.toBe("access_denied");
  });
});
