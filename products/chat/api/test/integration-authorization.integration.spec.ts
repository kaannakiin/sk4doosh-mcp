import type { ConfigService } from "@nestjs/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config/configuration.ts";
import { AuthorizationDiscoveryService } from "../src/connections/authorization-discovery.service.ts";
import { ClientRegistrationService } from "../src/connections/client-registration.service.ts";
import { CredentialCipherService } from "../src/connections/credential-cipher.service.ts";
import { IntegrationAuthorizationRepository } from "../src/connections/integration-authorization.repository.ts";
import { IntegrationAuthorizationService } from "../src/connections/integration-authorization.service.ts";
import { DbService } from "../src/db/db.service.ts";
import { json, startStub, type Stub } from "./oauth-stub.ts";

/**
 * Guard: gated on a url given only for testing, never on `CHAT_DATABASE_URL`.
 * These cases write rows, and falling back to the configured database would run
 * them against whatever this checkout is pointed at.
 */
const url = process.env.CHAT_TEST_DATABASE_URL;

const withDatabase = url === undefined ? describe.skip : describe;

const SECRET = Buffer.alloc(32, 29).toString("base64");

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

withDatabase("IntegrationAuthorizationRepository", () => {
  const config = configFor(url ?? "");
  let db: DbService;
  let repository: IntegrationAuthorizationRepository;
  let cipher: CredentialCipherService;
  let service: IntegrationAuthorizationService;
  let stub: Stub | undefined;
  const created: bigint[] = [];

  beforeAll(() => {
    db = new DbService(config);
    repository = new IntegrationAuthorizationRepository(db);
    cipher = new CredentialCipherService(config);
    service = new IntegrationAuthorizationService(
      new AuthorizationDiscoveryService(config),
      new ClientRegistrationService(config),
      repository,
      cipher,
    );
  });

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
    if (created.length > 0) {
      await db.client.integration.deleteMany({
        where: { id: { in: created.splice(0) } },
      });
    }
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  async function newIntegration(mcpUrl: string): Promise<{
    id: bigint;
    publicId: string;
    mcpUrl: string;
  }> {
    const row = await db.client.integration.create({
      data: { origin: "partner", displayName: "Motokurye", mcpUrl },
    });
    created.push(row.id);

    return { id: row.id, publicId: row.publicId, mcpUrl };
  }

  function serverAt(origin: string) {
    return {
      issuer: `${origin}/`,
      authorizationEndpoint: `${origin}/authorize`,
      tokenEndpoint: `${origin}/token`,
      registrationEndpoint: `${origin}/register`,
      revocationEndpoint: undefined,
      scopesSupported: ["orders.read"],
    };
  }

  const inADay = (): Date => new Date(Date.now() + 86_400_000);

  it("does not return a row whose resource is not the url that was asked about", async () => {
    const integration = await newIntegration("https://partner.example/mcp");
    await repository.saveDiscovery({
      integrationId: integration.id,
      resource: integration.mcpUrl,
      metadataUrl:
        "https://partner.example/.well-known/oauth-authorization-server",
      server: serverAt("https://partner.example"),
      staleAfter: inADay(),
    });

    await expect(
      repository.loadFresh(integration.id, "https://partner.example/other"),
    ).resolves.toBeUndefined();
    await expect(
      repository.loadFresh(integration.id, integration.mcpUrl),
    ).resolves.toBeDefined();
  });

  it("does not return a row past its staleness horizon", async () => {
    const integration = await newIntegration("https://stale.example/mcp");
    await repository.saveDiscovery({
      integrationId: integration.id,
      resource: integration.mcpUrl,
      metadataUrl:
        "https://stale.example/.well-known/oauth-authorization-server",
      server: serverAt("https://stale.example"),
      staleAfter: inADay(),
    });
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await db.client.integrationAuthorization.update({
      where: { integrationId: integration.id },
      data: {
        discoveredAt: twoDaysAgo,
        verifiedAt: twoDaysAgo,
        staleAfter: new Date(twoDaysAgo.getTime() + 86_400_000),
      },
    });

    await expect(
      repository.loadFresh(integration.id, integration.mcpUrl),
    ).resolves.toBeUndefined();
  });

  /**
   * Guard: the tokens a connection holds were minted by the server the row used
   * to name. Leaving them `active` after the issuer moves presents them to a
   * server that never issued them.
   */
  it("clears the client and re-authorizes every connection when the issuer moves", async () => {
    const integration = await newIntegration("https://moving.example/mcp");
    await repository.saveDiscovery({
      integrationId: integration.id,
      resource: integration.mcpUrl,
      metadataUrl:
        "https://moving.example/.well-known/oauth-authorization-server",
      server: serverAt("https://moving.example"),
      staleAfter: inADay(),
    });
    await repository.saveRegistration({
      integrationId: integration.id,
      issuer: "https://moving.example/",
      clientId: "cid-1",
      sealedClientSecret: await cipher.seal(
        integration.publicId,
        "client_secret",
        "s3cr3t",
      ),
      sealedRegistrationAccessToken: undefined,
      registrationClientUri: undefined,
      tokenEndpointAuthMethod: "client_secret_basic",
      registeredRedirectUri: CALLBACK,
      clientSecretExpiresAt: undefined,
      keyVersion: cipher.keyVersion,
    });

    const user = await db.client.user.create({
      data: { firstName: "Kaan", lastName: "Akın" },
    });
    const connection = await db.client.connection.create({
      data: { userId: user.id, integrationId: integration.id },
    });

    try {
      const changed = await repository.saveDiscovery({
        integrationId: integration.id,
        resource: integration.mcpUrl,
        metadataUrl:
          "https://elsewhere.example/.well-known/oauth-authorization-server",
        server: serverAt("https://elsewhere.example"),
        staleAfter: inADay(),
      });

      expect(changed).toBe(true);
      await expect(
        repository.loadFresh(integration.id, integration.mcpUrl),
      ).resolves.toMatchObject({
        clientId: undefined,
        sealedClientSecret: undefined,
        tokenEndpointAuthMethod: undefined,
        registeredRedirectUri: undefined,
      });
      await expect(
        db.client.connection.findUniqueOrThrow({
          where: { id: connection.id },
        }),
      ).resolves.toMatchObject({ status: "reauth_required" });
      await expect(
        db.client.connectionEvent.count({
          where: { connectionId: connection.id, kind: "reauth_required" },
        }),
      ).resolves.toBe(1);
    } finally {
      await db.client.user.delete({ where: { id: user.id } });
    }
  });

  /**
   * Guard: a re-discovery that moved the issuer while the registration request
   * was in flight must not have the issued client attached to it.
   */
  it("refuses to attach a client registered against an issuer the row no longer names", async () => {
    const integration = await newIntegration("https://raced.example/mcp");
    await repository.saveDiscovery({
      integrationId: integration.id,
      resource: integration.mcpUrl,
      metadataUrl:
        "https://raced.example/.well-known/oauth-authorization-server",
      server: serverAt("https://raced.example"),
      staleAfter: inADay(),
    });

    await expect(
      repository.saveRegistration({
        integrationId: integration.id,
        issuer: "https://stale-issuer.example/",
        clientId: "cid-9",
        sealedClientSecret: undefined,
        sealedRegistrationAccessToken: undefined,
        registrationClientUri: undefined,
        tokenEndpointAuthMethod: "none",
        registeredRedirectUri: CALLBACK,
        clientSecretExpiresAt: undefined,
        keyVersion: cipher.keyVersion,
      }),
    ).resolves.toBe(false);

    await expect(
      repository.loadFresh(integration.id, integration.mcpUrl),
    ).resolves.toMatchObject({ clientId: undefined });
  });

  it("discovers, registers and stores a client that only decrypts in place", async () => {
    stub = await startStub((call, origin) => {
      if (call.path === "/mcp") {
        return {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
          },
        };
      }

      if (call.path === "/.well-known/oauth-protected-resource/mcp") {
        return json({
          resource: `${origin}/mcp`,
          authorization_servers: [`${origin}/`],
          scopes_supported: ["orders.read"],
        });
      }

      if (call.path === "/.well-known/oauth-authorization-server") {
        return json({
          issuer: `${origin}/`,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          code_challenge_methods_supported: ["S256"],
        });
      }

      if (call.path === "/register") {
        return json(
          {
            client_id: "cid-live",
            client_secret: "live-secret",
            client_secret_expires_at: 0,
            token_endpoint_auth_method: "client_secret_basic",
          },
          201,
        );
      }

      return { status: 404 };
    });

    const integration = await newIntegration(`${stub.origin}/mcp`);
    const outcome = await service.ensureClient(integration);

    expect(outcome).toMatchObject({
      kind: "ready",
      clientId: "cid-live",
      tokenEndpointAuthMethod: "client_secret_basic",
      redirectUri: CALLBACK,
    });

    const stored = await repository.loadFresh(
      integration.id,
      integration.mcpUrl,
    );

    expect(stored?.sealedClientSecret).not.toContain("live-secret");
    await expect(
      cipher.open(
        integration.publicId,
        "client_secret",
        stored?.sealedClientSecret ?? "",
      ),
    ).resolves.toBe("live-secret");
    await expect(
      cipher.open(
        integration.publicId,
        "registration_access_token",
        stored?.sealedClientSecret ?? "",
      ),
    ).resolves.toBeUndefined();
  });

  it("reuses the stored client without asking the server again", async () => {
    let registrations = 0;
    stub = await startStub((call, origin) => {
      if (call.path === "/mcp") {
        return {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
          },
        };
      }

      if (call.path === "/.well-known/oauth-protected-resource/mcp") {
        return json({
          resource: `${origin}/mcp`,
          authorization_servers: [`${origin}/`],
        });
      }

      if (call.path === "/.well-known/oauth-authorization-server") {
        return json({
          issuer: `${origin}/`,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          code_challenge_methods_supported: ["S256"],
        });
      }

      if (call.path === "/register") {
        registrations += 1;

        return json(
          { client_id: "cid-once", token_endpoint_auth_method: "none" },
          201,
        );
      }

      return { status: 404 };
    });

    const integration = await newIntegration(`${stub.origin}/mcp`);
    await service.ensureClient(integration);
    await service.ensureClient(integration);

    expect(registrations).toBe(1);
  });
});
