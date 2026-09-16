import type { ConfigService } from "@nestjs/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config/configuration.ts";
import { AuthorizationDiscoveryService } from "../src/connections/authorization-discovery.service.ts";
import { ClientRegistrationService } from "../src/connections/client-registration.service.ts";
import { ConnectionTokenService } from "../src/connections/connection-token.service.ts";
import { ConnectionRepository } from "../src/connections/connection.repository.ts";
import { CredentialCipherService } from "../src/connections/credential-cipher.service.ts";
import { IntegrationAuthorizationRepository } from "../src/connections/integration-authorization.repository.ts";
import { IntegrationAuthorizationService } from "../src/connections/integration-authorization.service.ts";
import { IntegrationRegistrationService } from "../src/connections/integration-registration.service.ts";
import { IntegrationRepository } from "../src/connections/integration.repository.ts";
import { IntegrationToolsService } from "../src/connections/integration-tools.service.ts";
import { DbService } from "../src/db/db.service.ts";
import type { UserId } from "../src/db/ids.ts";
import { mcpStub, type StubTool } from "./mcp-stub.ts";
import { startStub, type StubCall, type StubReply, type Stub } from "./oauth-stub.ts";

const url = process.env.CHAT_TEST_DATABASE_URL;

const withDatabase = url === undefined ? describe.skip : describe;

const SECRET = Buffer.alloc(32, 43).toString("base64");

function configFor(databaseUrl: string): ConfigService<AppConfig, true> {
  const values: Record<string, unknown> = {
    environment: "development",
    pathPrefix: "/api",
    auth: { publicApiUrl: "http://127.0.0.1:5191" },
    "auth.secret": SECRET,
    database: { url: databaseUrl, poolMax: 4 },
  };

  return {
    get: (key: string): unknown => values[key],
  } as unknown as ConfigService<AppConfig, true>;
}

withDatabase("IntegrationToolsService", () => {
  const config = configFor(url ?? "");
  let db: DbService;
  let integrations: IntegrationRepository;
  let registration: IntegrationRegistrationService;
  let tools: IntegrationToolsService;
  let stub: Stub | undefined;
  const users: bigint[] = [];

  beforeAll(() => {
    db = new DbService(config);
    const cipher = new CredentialCipherService(config);
    integrations = new IntegrationRepository(db);
    const discovery = new AuthorizationDiscoveryService(config);
    const authorization = new IntegrationAuthorizationService(
      discovery,
      new ClientRegistrationService(config),
      new IntegrationAuthorizationRepository(db),
      cipher,
    );
    registration = new IntegrationRegistrationService(
      integrations,
      authorization,
      discovery,
      config,
    );
    tools = new IntegrationToolsService(
      integrations,
      new ConnectionTokenService(
        new ConnectionRepository(db),
        integrations,
        authorization,
        cipher,
        config,
      ),
      authorization,
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

  async function owner(): Promise<UserId> {
    const row = await db.client.user.create({
      data: { firstName: "Kaan", lastName: "Akın" },
    });
    users.push(row.id);

    return row.id.toString() as UserId;
  }

  /**
   * A server that is open until `guarded` is flipped, then answers every frame
   * with a challenge while still serving its authorization metadata.
   */
  function shiftingServer() {
    const state = { guarded: false };
    const open = mcpStub({ open: true, tools: [] });
    const secured = mcpStub({ tools: [] });

    const handler = (call: StubCall, origin: string): StubReply => {
      const [path] = call.path.split("?");
      if (path === "/mcp" && state.guarded) {
        return {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
          },
        };
      }

      return (state.guarded ? secured : open).handler(call, origin);
    };

    return { handler, state, registrations: () => secured.state.registrations };
  }

  async function registerAt(handler: Parameters<typeof startStub>[0]): Promise<{
    userId: UserId;
    integrationId: string;
    rowId: bigint;
  }> {
    stub = await startStub(handler);
    const userId = await owner();
    const created = await registration.register(userId, {
      mcpUrl: `${stub.origin}/mcp`,
    });

    if (created.kind !== "created") {
      throw new Error(`could not register: ${created.failure}`);
    }

    const row = await integrations.loadVisible(userId, created.integration.id);

    return {
      userId,
      integrationId: created.integration.id,
      rowId: row?.id ?? 0n,
    };
  }

  it("rewrites the tool list from what the server now offers", async () => {
    /**
     * Guard: one stub for the whole case. A replacement listens on a new port
     * while the integration still names the old one, so the refresh would be
     * measuring an address nobody is serving.
     */
    const listed: StubTool[] = [{ name: "old_tool" }];
    const subject = await registerAt(
      mcpStub({ open: true, tools: listed, pageSize: 50 }).handler,
    );

    listed.splice(0, listed.length, { name: "new_tool" }, { name: "second" });

    await expect(
      tools.refresh(subject.userId, subject.integrationId),
    ).resolves.toMatchObject({ kind: "refreshed", toolCount: 2 });

    const rows = await db.client.integrationTool.findMany({
      where: { integrationId: subject.rowId },
      select: { name: true },
      orderBy: { name: "asc" },
    });

    expect(rows.map(({ name }) => name)).toEqual(["new_tool", "second"]);
  });

  /**
   * Guard: a server that starts asking for a token must not leave the reader
   * with a card that only ever fails. The integration and its history stay; the
   * reader is asked to authorize once.
   */
  it("moves an integration onto the authorization path when the server closes", async () => {
    const shifting = shiftingServer();
    const subject = await registerAt(shifting.handler);

    shifting.state.guarded = true;

    await expect(
      tools.refresh(subject.userId, subject.integrationId),
    ).resolves.toMatchObject({ kind: "upgraded" });

    const row = await db.client.integration.findUniqueOrThrow({
      where: { id: subject.rowId },
      select: { authMode: true },
    });

    expect(row.authMode).toBe("oauth");
    expect(shifting.registrations()).toBe(1);

    const connection = await db.client.connection.findFirstOrThrow({
      where: { integrationId: subject.rowId },
    });

    expect(connection.status).toBe("reauth_required");
    await expect(
      db.client.connectionEvent.count({
        where: { connectionId: connection.id, kind: "reauth_required" },
      }),
    ).resolves.toBe(1);
  });

  /**
   * Guard: an integration moved to `oauth` with no client behind it can neither
   * be used openly nor authorized, so a failed upgrade must change nothing.
   */
  it("leaves the integration open when the upgrade cannot be completed", async () => {
    const guarded = { on: false };
    const open = mcpStub({ open: true, tools: [{ name: "t" }], pageSize: 50 });
    const subject = await registerAt((call, origin) =>
      guarded.on
        ? { status: 401, headers: { "www-authenticate": "Bearer" } }
        : open.handler(call, origin),
    );

    guarded.on = true;

    await expect(
      tools.refresh(subject.userId, subject.integrationId),
    ).resolves.toMatchObject({ kind: "provider_unavailable" });

    const row = await db.client.integration.findUniqueOrThrow({
      where: { id: subject.rowId },
      select: { authMode: true },
    });

    expect(row.authMode).toBe("none");
    const connection = await db.client.connection.findFirstOrThrow({
      where: { integrationId: subject.rowId },
    });

    expect(connection.status).toBe("active");
  });

  it("refuses to refresh an integration the caller cannot see", async () => {
    const subject = await registerAt(
      mcpStub({ open: true, tools: [{ name: "t" }], pageSize: 50 }).handler,
    );
    const stranger = await owner();

    await expect(
      tools.refresh(stranger, subject.integrationId),
    ).resolves.toMatchObject({ kind: "not_found" });
  });
});
