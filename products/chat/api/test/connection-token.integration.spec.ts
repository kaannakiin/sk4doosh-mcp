import type { ConfigService } from "@nestjs/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config/configuration.ts";
import { AuthorizationDiscoveryService } from "../src/connections/authorization-discovery.service.ts";
import { ClientRegistrationService } from "../src/connections/client-registration.service.ts";
import { ConnectionRevocationService } from "../src/connections/connection-revocation.service.ts";
import { ConnectionTokenService } from "../src/connections/connection-token.service.ts";
import { ConnectionRepository } from "../src/connections/connection.repository.ts";
import { CredentialCipherService } from "../src/connections/credential-cipher.service.ts";
import { IntegrationAuthorizationRepository } from "../src/connections/integration-authorization.repository.ts";
import { IntegrationAuthorizationService } from "../src/connections/integration-authorization.service.ts";
import { IntegrationRegistrationService } from "../src/connections/integration-registration.service.ts";
import { IntegrationRepository } from "../src/connections/integration.repository.ts";
import { DbService } from "../src/db/db.service.ts";
import type { UserId } from "../src/db/ids.ts";
import { mcpStub, type McpStubOptions, type StubState } from "./mcp-stub.ts";
import { startStub, type Stub } from "./oauth-stub.ts";

const url = process.env.CHAT_TEST_DATABASE_URL;

const withDatabase = url === undefined ? describe.skip : describe;

const SECRET = Buffer.alloc(32, 37).toString("base64");

function configFor(databaseUrl: string): ConfigService<AppConfig, true> {
  const values: Record<string, unknown> = {
    environment: "development",
    pathPrefix: "/api",
    auth: { publicApiUrl: "http://127.0.0.1:5191" },
    "auth.secret": SECRET,
    database: { url: databaseUrl, poolMax: 5 },
  };

  return {
    get: (key: string): unknown => values[key],
  } as unknown as ConfigService<AppConfig, true>;
}

withDatabase("ConnectionTokenService", () => {
  const config = configFor(url ?? "");
  let db: DbService;
  let cipher: CredentialCipherService;
  let connections: ConnectionRepository;
  let integrations: IntegrationRepository;
  let registration: IntegrationRegistrationService;
  let tokens: ConnectionTokenService;
  let revocation: ConnectionRevocationService;
  let stub: Stub | undefined;
  const users: bigint[] = [];

  beforeAll(() => {
    db = new DbService(config);
    cipher = new CredentialCipherService(config);
    connections = new ConnectionRepository(db);
    integrations = new IntegrationRepository(db);
    const clients = new IntegrationAuthorizationRepository(db);
    const discovery = new AuthorizationDiscoveryService(config);
    const authorization = new IntegrationAuthorizationService(
      discovery,
      new ClientRegistrationService(config),
      clients,
      cipher,
    );
    registration = new IntegrationRegistrationService(
      integrations,
      authorization,
      discovery,
      config,
    );
    tokens = new ConnectionTokenService(
      connections,
      integrations,
      authorization,
      cipher,
      config,
    );
    revocation = new ConnectionRevocationService(
      connections,
      integrations,
      clients,
      authorization,
      cipher,
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
   * Builds a connected integration: a live stub, a registered client, and a
   * connection holding sealed tokens as the callback would have written them.
   */
  async function connected(options: McpStubOptions = {}): Promise<{
    userId: UserId;
    integrationId: string;
    integrationRowId: bigint;
    connectionId: bigint;
    state: StubState;
  }> {
    const server = mcpStub(options);
    stub = await startStub(server.handler);

    const user = await db.client.user.create({
      data: { firstName: "Kaan", lastName: "Akın" },
    });
    users.push(user.id);
    const userId = user.id.toString() as UserId;

    const created = await registration.register(userId, {
      mcpUrl: `${stub.origin}/mcp`,
    });

    if (created.kind !== "created") {
      throw new Error(`could not register: ${created.failure}`);
    }

    const row = await integrations.loadVisible(userId, created.integration.id);
    if (row === undefined) {
      throw new Error("the integration went missing");
    }

    server.state.accessToken = "at-seed";
    server.state.refreshToken = "rt-seed";

    const { publicId } = await connections.beginAuthorization(user.id, row.id);
    await connections.completeAuthorization(
      {
        userId: user.id,
        integrationId: row.id,
        sealedAccessToken: await cipher.seal(
          publicId,
          "access_token",
          "at-seed",
        ),
        sealedRefreshToken: await cipher.seal(
          publicId,
          "refresh_token",
          "rt-seed",
        ),
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        providerScope: "orders.read",
        keyVersion: cipher.keyVersion,
      },
      false,
    );

    const connection = await db.client.connection.findUniqueOrThrow({
      where: { userId_integrationId: { userId: user.id, integrationId: row.id } },
      select: { id: true },
    });

    return {
      userId,
      integrationId: created.integration.id,
      integrationRowId: row.id,
      connectionId: connection.id,
      state: server.state,
    };
  }

  async function expire(connectionId: bigint): Promise<void> {
    await db.client.connection.update({
      where: { id: connectionId },
      data: { tokenExpiresAt: new Date(Date.now() - 1000) },
    });
  }

  it("presents the stored token while it is still good", async () => {
    const subject = await connected();
    const before = subject.state.grants.length;

    await expect(
      tokens.accessTokenFor(subject.userId, subject.integrationId),
    ).resolves.toMatchObject({ kind: "ok", accessToken: "at-seed" });
    expect(subject.state.grants).toHaveLength(before);
  });

  it("renews a token that has run out", async () => {
    const subject = await connected();
    await expire(subject.connectionId);

    const outcome = await tokens.accessTokenFor(
      subject.userId,
      subject.integrationId,
    );

    expect(outcome).toMatchObject({ kind: "ok", accessToken: "at-1" });
    expect(subject.state.grants).toEqual([
      { grantType: "refresh_token", resource: `${stub?.origin ?? ""}/mcp` },
    ]);
  });

  /**
   * Guard: RFC 8707 binds the issued token to one resource, and a refresh that
   * omitted it would widen the token past the server the user consented to.
   */
  it("binds the renewed token to the same resource", async () => {
    const subject = await connected();
    await expire(subject.connectionId);
    await tokens.accessTokenFor(subject.userId, subject.integrationId);

    expect(subject.state.grants[0]?.resource).toBe(`${stub?.origin ?? ""}/mcp`);
  });

  /**
   * Guard: an authorization server that rotates refresh tokens answers the
   * second spend of one with `invalid_grant`, and that answer is
   * indistinguishable from a grant the user actually revoked.
   */
  it("spends the refresh token once when two callers arrive together", async () => {
    const subject = await connected({ rotateRefresh: true });
    await expire(subject.connectionId);

    const outcomes = await Promise.all([
      tokens.accessTokenFor(subject.userId, subject.integrationId),
      tokens.accessTokenFor(subject.userId, subject.integrationId),
    ]);

    expect(subject.state.grants).toHaveLength(1);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ kind: "ok", accessToken: "at-1" });
    }
  });

  it("stores the rotated refresh token rather than the one it spent", async () => {
    const subject = await connected({ rotateRefresh: true });
    await expire(subject.connectionId);
    await tokens.accessTokenFor(subject.userId, subject.integrationId);
    await expire(subject.connectionId);

    await expect(
      tokens.accessTokenFor(subject.userId, subject.integrationId),
    ).resolves.toMatchObject({ kind: "ok", accessToken: "at-2" });
    expect(subject.state.grants).toHaveLength(2);
  });

  it("asks for authorization again when the server refuses the refresh", async () => {
    const subject = await connected({ refreshRejected: true });
    await expire(subject.connectionId);

    await expect(
      tokens.accessTokenFor(subject.userId, subject.integrationId),
    ).resolves.toMatchObject({ kind: "reauth_required" });

    const row = await db.client.connection.findUniqueOrThrow({
      where: { id: subject.connectionId },
      omit: { accessToken: false, refreshToken: false },
    });

    expect(row).toMatchObject({
      status: "reauth_required",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      tokenKeyVersion: null,
      refreshLeaseUntil: null,
    });
    await expect(
      db.client.connectionEvent.count({
        where: { connectionId: subject.connectionId, kind: "reauth_required" },
      }),
    ).resolves.toBe(1);
  });

  /**
   * Guard: an outage at the provider is not a reason to make everyone who uses
   * it authorize again.
   */
  it("leaves the connection alone when the server cannot be reached", async () => {
    const subject = await connected();
    await expire(subject.connectionId);
    await stub?.close();
    stub = undefined;

    await expect(
      tokens.accessTokenFor(subject.userId, subject.integrationId),
    ).resolves.toMatchObject({ kind: "provider_unavailable" });

    const row = await db.client.connection.findUniqueOrThrow({
      where: { id: subject.connectionId },
      omit: { refreshToken: false },
    });

    expect(row.status).toBe("active");
    expect(row.refreshToken).not.toBeNull();
    expect(row.refreshLeaseUntil).toBeNull();
  });

  /**
   * Guard: answered without touching the network. Running the refresh path
   * against a server that asks for no credential would look for an
   * authorization server that does not exist and end by marking a working
   * integration as needing authorization again.
   */
  it("has no token to present for a server that asks for none", async () => {
    const server = mcpStub({ open: true, tools: [{ name: "t" }] });
    stub = await startStub(server.handler);
    const user = await db.client.user.create({
      data: { firstName: "Kaan", lastName: "Akın" },
    });
    users.push(user.id);
    const userId = user.id.toString() as UserId;
    const created = await registration.register(userId, {
      mcpUrl: `${stub.origin}/mcp`,
    });
    const id = created.kind === "created" ? created.integration.id : "missing";
    const before = stub.calls.length;

    await expect(tokens.accessTokenFor(userId, id)).resolves.toEqual({
      kind: "open",
    });
    expect(stub.calls).toHaveLength(before);
  });

  it("refuses to hand a token to somebody who is not the owner", async () => {
    const subject = await connected();
    const stranger = await db.client.user.create({
      data: { firstName: "Ada", lastName: "L" },
    });
    users.push(stranger.id);

    await expect(
      tokens.accessTokenFor(
        stranger.id.toString() as UserId,
        subject.integrationId,
      ),
    ).resolves.toMatchObject({ kind: "not_connected" });
  });

  /**
   * Guard: the refresh token is revoked first. It is the one that can mint more
   * access tokens, so a process that died between the two calls would leave the
   * renewable half of the grant alive.
   */
  it("revokes the refresh token before the access token on disconnect", async () => {
    const subject = await connected({ revocation: true });

    await expect(
      revocation.disconnect(subject.userId, subject.integrationId),
    ).resolves.toBe("disconnected");

    expect(subject.state.revocations).toEqual([
      { token: "rt-seed", hint: "refresh_token" },
      { token: "at-seed", hint: "access_token" },
    ]);
  });

  it("clears the local row whether or not the provider accepted", async () => {
    const subject = await connected();

    await expect(
      revocation.disconnect(subject.userId, subject.integrationId),
    ).resolves.toBe("disconnected");

    const row = await db.client.connection.findUniqueOrThrow({
      where: { id: subject.connectionId },
      omit: { accessToken: false, refreshToken: false },
    });

    expect(row).toMatchObject({
      status: "revoked",
      accessToken: null,
      refreshToken: null,
    });
    expect(row.revokedAt).not.toBeNull();
    await expect(
      db.client.connectionEvent.count({
        where: { connectionId: subject.connectionId, kind: "revoked" },
      }),
    ).resolves.toBe(1);
  });

  it("takes the tools with the integration when it is removed", async () => {
    const subject = await connected();
    await integrations.replaceTools(subject.integrationRowId, [
      { name: "orders_me", inputSchema: { type: "object" } },
    ]);

    await expect(
      integrations.removeOwned(subject.userId, subject.integrationId),
    ).resolves.toBe(true);
    await expect(
      db.client.integrationTool.count({
        where: { integrationId: subject.integrationRowId },
      }),
    ).resolves.toBe(0);
  });
});
