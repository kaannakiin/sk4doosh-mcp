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
import { IntegrationCatalogService } from "../src/connections/integration-catalog.service.ts";
import { IntegrationRegistrationService } from "../src/connections/integration-registration.service.ts";
import { IntegrationRepository } from "../src/connections/integration.repository.ts";
import { IntegrationToolRepository } from "../src/connections/integration-tool.repository.ts";
import { DbService } from "../src/db/db.service.ts";
import type { UserId } from "../src/db/ids.ts";
import { mcpStub, type StubTool } from "./mcp-stub.ts";
import { startStub, type Stub } from "./oauth-stub.ts";

const url = process.env.CHAT_TEST_DATABASE_URL;

const withDatabase = url === undefined ? describe.skip : describe;

const SECRET = Buffer.alloc(32, 43).toString("base64");

const HOUR_MS = 60 * 60 * 1000;

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

withDatabase("IntegrationCatalogService", () => {
  const config = configFor(url ?? "");
  let db: DbService;
  let integrations: IntegrationRepository;
  let toolRows: IntegrationToolRepository;
  let registration: IntegrationRegistrationService;
  let catalog: IntegrationCatalogService;
  let stub: Stub | undefined;
  const users: bigint[] = [];

  beforeAll(() => {
    db = new DbService(config);
    const cipher = new CredentialCipherService(config);
    integrations = new IntegrationRepository(db);
    toolRows = new IntegrationToolRepository(db);
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
    catalog = new IntegrationCatalogService(
      toolRows,
      integrations,
      new ConnectionTokenService(
        new ConnectionRepository(db),
        integrations,
        authorization,
        cipher,
        config,
      ),
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

  async function openServer(tools: readonly StubTool[]) {
    const server = mcpStub({ open: true, tools });
    stub = await startStub(server.handler);

    return server;
  }

  async function connect(
    userId: UserId,
    origin: string,
  ): Promise<{ id: string }> {
    const outcome = await registration.register(userId, {
      mcpUrl: `${origin}/mcp`,
    });
    if (outcome.kind === "refused") {
      throw new Error(`registration refused: ${outcome.failure}`);
    }

    return outcome.integration;
  }

  async function ageTools(integrationId: string, byMs: number): Promise<void> {
    await db.client.integration.update({
      where: { publicId: integrationId },
      data: { toolsRefreshedAt: new Date(Date.now() - byMs) },
    });
  }

  it("serves the stored tools without re-reading a fresh list", async () => {
    const userId = await owner();
    const server = await openServer([{ name: "list_zones" }]);
    await connect(userId, stub?.origin ?? "");
    const listedAtRegistration = server.state.toolListings.length;

    const tools = await catalog.catalogFor(userId);

    expect(tools.map(({ remoteName }) => remoteName)).toEqual(["list_zones"]);
    expect(server.state.toolListings).toHaveLength(listedAtRegistration);
  });

  it("re-reads a list that has gone stale", async () => {
    const userId = await owner();
    const server = await openServer([{ name: "list_zones" }]);
    const integration = await connect(userId, stub?.origin ?? "");
    const listedAtRegistration = server.state.toolListings.length;
    await ageTools(integration.id, HOUR_MS + 1000);

    await catalog.catalogFor(userId);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(server.state.toolListings.length).toBeGreaterThan(
      listedAtRegistration,
    );
  });

  it("lets exactly one of two concurrent turns claim the refresh", async () => {
    const userId = await owner();
    const server = await openServer([{ name: "list_zones" }]);
    const integration = await connect(userId, stub?.origin ?? "");
    const before = server.state.toolListings.length;
    await ageTools(integration.id, HOUR_MS + 1000);

    await Promise.all([catalog.catalogFor(userId), catalog.catalogFor(userId)]);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(server.state.toolListings.length - before).toBe(1);
  });

  it("consumes the window when the server could not be read", async () => {
    const userId = await owner();
    const server = await openServer([{ name: "list_zones" }]);
    const integration = await connect(userId, stub?.origin ?? "");
    await ageTools(integration.id, HOUR_MS + 1000);
    await stub?.close();
    stub = undefined;

    await catalog.catalogFor(userId);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const row = await db.client.integration.findFirstOrThrow({
      where: { publicId: integration.id },
      select: { toolsRefreshedAt: true, toolsRefreshFailedAt: true },
    });

    expect(row.toolsRefreshFailedAt).not.toBeNull();
    expect(row.toolsRefreshedAt?.getTime()).toBeGreaterThan(
      Date.now() - HOUR_MS,
    );
    expect(await toolRows.catalogFor(userId)).toHaveLength(1);
    expect(server.state.toolListings.length).toBeGreaterThan(0);
  });

  it("offers nothing for a connection that is no longer active", async () => {
    const userId = await owner();
    await openServer([{ name: "list_zones" }]);
    const integration = await connect(userId, stub?.origin ?? "");
    await db.client.connection.updateMany({
      where: { integration: { publicId: integration.id } },
      data: { status: "revoked", revokedAt: new Date() },
    });

    expect(await catalog.catalogFor(userId)).toHaveLength(0);
  });

  it("carries the digest and the destructive claim into the catalog", async () => {
    const userId = await owner();
    await openServer([
      { name: "delete_zone", annotations: { destructiveHint: true } },
      { name: "list_zones" },
    ]);
    await connect(userId, stub?.origin ?? "");

    const tools = await catalog.catalogFor(userId);
    const destroyer = tools.find(({ remoteName }) => remoteName === "delete_zone");
    const lister = tools.find(({ remoteName }) => remoteName === "list_zones");

    expect(destroyer?.destructive).toBe(true);
    expect(lister?.destructive).toBe(false);
    expect(destroyer?.definitionDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(destroyer?.definitionDigest).not.toBe(lister?.definitionDigest);
  });
});
