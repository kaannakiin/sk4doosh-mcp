import type { ConfigService } from "@nestjs/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config/configuration.ts";
import { AuthorizationDiscoveryService } from "../src/connections/authorization-discovery.service.ts";
import { ClientRegistrationService } from "../src/connections/client-registration.service.ts";
import { CredentialCipherService } from "../src/connections/credential-cipher.service.ts";
import { IntegrationAuthorizationRepository } from "../src/connections/integration-authorization.repository.ts";
import { IntegrationAuthorizationService } from "../src/connections/integration-authorization.service.ts";
import { IntegrationRegistrationService } from "../src/connections/integration-registration.service.ts";
import { IntegrationRepository } from "../src/connections/integration.repository.ts";
import { DbService } from "../src/db/db.service.ts";
import type { UserId } from "../src/db/ids.ts";
import { mcpStub } from "./mcp-stub.ts";
import { json, startStub, type Stub } from "./oauth-stub.ts";

const url = process.env.CHAT_TEST_DATABASE_URL;

const withDatabase = url === undefined ? describe.skip : describe;

const SECRET = Buffer.alloc(32, 31).toString("base64");

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

withDatabase("IntegrationRegistrationService", () => {
  const config = configFor(url ?? "");
  let db: DbService;
  let integrations: IntegrationRepository;
  let service: IntegrationRegistrationService;
  let stub: Stub | undefined;
  const users: bigint[] = [];

  beforeAll(() => {
    db = new DbService(config);
    integrations = new IntegrationRepository(db);
    const cipher = new CredentialCipherService(config);
    const discovery = new AuthorizationDiscoveryService(config);
    service = new IntegrationRegistrationService(
      integrations,
      new IntegrationAuthorizationService(
        discovery,
        new ClientRegistrationService(config),
        new IntegrationAuthorizationRepository(db),
        cipher,
      ),
      discovery,
      config,
    );
  });

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
    if (users.length > 0) {
      await db.client.user.deleteMany({
        where: { id: { in: users.splice(0) } },
      });
    }
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  /**
   * Guard: the owner's own rows, not `listFor`. That query deliberately also
   * returns every partner integration, so counting it would tie these cases to
   * whatever else happens to be in the database.
   */
  function ownedCount(userId: UserId): Promise<number> {
    return db.client.integration.count({ where: { ownerId: BigInt(userId) } });
  }

  async function owner(): Promise<UserId> {
    const user = await db.client.user.create({
      data: { firstName: "Kaan", lastName: "Akın" },
    });
    users.push(user.id);

    return user.id.toString() as UserId;
  }

  it("registers a server it could discover and register a client at", async () => {
    stub = await startStub(mcpStub().handler);
    const userId = await owner();

    const outcome = await service.register(userId, {
      mcpUrl: `${stub.origin}/mcp`,
    });

    expect(outcome).toMatchObject({
      kind: "created",
      integration: { origin: "user", toolCount: 0, connection: null },
    });
    await expect(ownedCount(userId)).resolves.toBe(1);
  });

  it("labels the integration with the host when none was given", async () => {
    stub = await startStub(mcpStub().handler);
    const userId = await owner();
    const outcome = await service.register(userId, {
      mcpUrl: `${stub.origin}/mcp`,
    });

    expect(outcome).toMatchObject({
      integration: { displayName: new URL(stub.origin).host },
    });
  });

  it("refuses a second add of the same server by the same owner", async () => {
    stub = await startStub(mcpStub().handler);
    const userId = await owner();
    await service.register(userId, { mcpUrl: `${stub.origin}/mcp` });

    await expect(
      service.register(userId, { mcpUrl: `${stub.origin}/mcp` }),
    ).resolves.toMatchObject({
      kind: "refused",
      failure: "integration_duplicate",
    });
  });

  it("refuses an address that is not a transport this platform will use", async () => {
    const userId = await owner();

    await expect(
      service.register(userId, { mcpUrl: "http://example.com/mcp" }),
    ).resolves.toMatchObject({
      kind: "refused",
      failure: "integration_url_invalid",
    });
  });

  /**
   * Guard: an integration with no client is one the connect flow can only ever
   * refuse, so it must not survive as a row the reader is offered a button for.
   */
  it("leaves no row behind when the server publishes no metadata", async () => {
    stub = await startStub(() => ({ status: 404 }));
    const userId = await owner();

    await expect(
      service.register(userId, { mcpUrl: `${stub.origin}/mcp` }),
    ).resolves.toMatchObject({ kind: "refused" });
    await expect(ownedCount(userId)).resolves.toBe(0);
  });

  it("reports a server that cannot register a client apart from one that is unreachable", async () => {
    stub = await startStub((call, origin) => {
      const [path] = call.path.split("?");
      if (path === "/.well-known/oauth-protected-resource/mcp") {
        return json({
          resource: `${origin}/mcp`,
          authorization_servers: [`${origin}/`],
        });
      }

      if (path === "/.well-known/oauth-authorization-server") {
        return json({
          issuer: `${origin}/`,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          code_challenge_methods_supported: ["S256"],
        });
      }

      return { status: 401 };
    });
    const userId = await owner();

    await expect(
      service.register(userId, { mcpUrl: `${stub.origin}/mcp` }),
    ).resolves.toMatchObject({
      kind: "refused",
      failure: "integration_auth_unsupported",
    });
  });

  it("registers a server that asks for no credential in one step", async () => {
    stub = await startStub(
      mcpStub({ open: true, tools: [{ name: "list_sections" }, { name: "get_docs" }] })
        .handler,
    );
    const userId = await owner();

    const outcome = await service.register(userId, {
      mcpUrl: `${stub.origin}/mcp`,
    });

    expect(outcome).toMatchObject({
      kind: "created",
      integration: {
        authMode: "none",
        toolCount: 2,
        connection: { status: "active" },
      },
    });
  });

  /**
   * Guard: an open server has nothing to authorize, so the row that records
   * "this person wired this server up" is opened `active` carrying no token —
   * which is what `authorizeInvocation` needs and what the column constraint
   * accepts.
   */
  it("opens a connection carrying no token at all", async () => {
    stub = await startStub(mcpStub({ open: true, tools: [{ name: "t" }] }).handler);
    const userId = await owner();
    const created = await service.register(userId, {
      mcpUrl: `${stub.origin}/mcp`,
    });
    const id = created.kind === "created" ? created.integration.id : "missing";

    const row = await db.client.connection.findFirstOrThrow({
      where: { integration: { publicId: id } },
      omit: { accessToken: false, refreshToken: false },
    });

    expect(row).toMatchObject({
      status: "active",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      tokenKeyVersion: null,
    });
    expect(row.authorizedAt).not.toBeNull();
    await expect(
      db.client.integrationAuthorization.count({
        where: { integration: { publicId: id } },
      }),
    ).resolves.toBe(0);
  });

  /**
   * Guard: answering `initialize` to anybody is not proof a server is open. The
   * claim is only accepted once the tools have actually been listed without a
   * token.
   */
  it("falls back to the authorization path when the tools are guarded", async () => {
    const guarded = mcpStub({ tools: [{ name: "t" }] });
    stub = await startStub((call, origin) => {
      const [path] = call.path.split("?");
      if (path === "/mcp") {
        const frame = JSON.parse(call.body) as { method: string };

        return frame.method === "initialize"
          ? { status: 200, headers: { "content-type": "application/json" }, body: "{}" }
          : {
              status: 401,
              headers: {
                "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
              },
            };
      }

      return guarded.handler(call, origin);
    });
    const userId = await owner();

    await expect(
      service.register(userId, { mcpUrl: `${stub.origin}/mcp` }),
    ).resolves.toMatchObject({
      kind: "created",
      integration: { authMode: "oauth", connection: null },
    });
    expect(guarded.state.registrations).toBe(1);
  });

  it("refuses a second add of an open server", async () => {
    stub = await startStub(mcpStub({ open: true, tools: [{ name: "t" }] }).handler);
    const userId = await owner();
    await service.register(userId, { mcpUrl: `${stub.origin}/mcp` });

    await expect(
      service.register(userId, { mcpUrl: `${stub.origin}/mcp` }),
    ).resolves.toMatchObject({
      kind: "refused",
      failure: "integration_duplicate",
    });
    await expect(ownedCount(userId)).resolves.toBe(1);
  });

  /**
   * Guard: the regression this whole slice came from. A server that answered but
   * publishes no authorization metadata was reported as "did not answer".
   */
  it("says a server that answered is not an MCP server, not that it was unreachable", async () => {
    stub = await startStub(() => ({
      status: 401,
      headers: { "www-authenticate": "Bearer" },
    }));
    const userId = await owner();

    await expect(
      service.register(userId, { mcpUrl: `${stub.origin}/mcp` }),
    ).resolves.toMatchObject({
      kind: "refused",
      failure: "integration_not_mcp",
    });
    await expect(ownedCount(userId)).resolves.toBe(0);
  });

  /**
   * Guard: the row is written before this process can reach the provider, so a
   * crash in between leaves one that never got a client. These three cases are
   * that window, simulated by inserting the row the way the crash would have
   * left it.
   */
  async function orphan(userId: UserId, mcpUrl: string): Promise<string> {
    const row = await db.client.integration.create({
      data: {
        origin: "user",
        ownerId: BigInt(userId),
        displayName: "half written",
        mcpUrl,
      },
      select: { publicId: true },
    });

    return row.publicId;
  }

  it("completes a row a crashed add left behind", async () => {
    stub = await startStub(mcpStub().handler);
    const userId = await owner();
    const publicId = await orphan(userId, `${stub.origin}/mcp`);

    await expect(
      service.register(userId, { mcpUrl: `${stub.origin}/mcp` }),
    ).resolves.toMatchObject({
      kind: "refused",
      failure: "integration_duplicate",
    });

    const authorization =
      await db.client.integrationAuthorization.findFirst({
        where: { integration: { publicId } },
        select: { clientId: true },
      });

    expect(authorization?.clientId).toBe("cid-stub");
    await expect(ownedCount(userId)).resolves.toBe(1);
  });

  it("reports the real reason rather than a duplicate when the row cannot be completed", async () => {
    stub = await startStub(() => ({ status: 404 }));
    const userId = await owner();
    await orphan(userId, `${stub.origin}/mcp`);

    await expect(
      service.register(userId, { mcpUrl: `${stub.origin}/mcp` }),
    ).resolves.toMatchObject({
      kind: "refused",
      failure: "integration_not_mcp",
    });
    await expect(ownedCount(userId)).resolves.toBe(0);
  });

  /**
   * Guard: the retry path deletes what it could not complete, so a row somebody
   * has authorized must never reach it.
   */
  it("refuses a duplicate that is in use without touching it", async () => {
    stub = await startStub(mcpStub().handler);
    const userId = await owner();
    const created = await service.register(userId, {
      mcpUrl: `${stub.origin}/mcp`,
    });
    const id = created.kind === "created" ? created.integration.id : "missing";
    const row = await integrations.loadVisible(userId, id);
    await db.client.connection.create({
      data: {
        userId: BigInt(userId),
        integrationId: row?.id ?? 0n,
        status: "reauth_required",
      },
    });

    await stub.close();
    stub = undefined;

    await expect(
      service.register(userId, { mcpUrl: `${row?.mcpUrl ?? ""}` }),
    ).resolves.toMatchObject({
      kind: "refused",
      failure: "integration_duplicate",
    });
    await expect(ownedCount(userId)).resolves.toBe(1);
  });

  it("removes only the owner's own integration", async () => {
    stub = await startStub(mcpStub().handler);
    const mine = await owner();
    const theirs = await owner();
    const created = await service.register(mine, {
      mcpUrl: `${stub.origin}/mcp`,
    });

    const id =
      created.kind === "created" ? created.integration.id : "missing";

    await expect(integrations.removeOwned(theirs, id)).resolves.toBe(false);
    await expect(integrations.removeOwned(mine, id)).resolves.toBe(true);
  });
});
