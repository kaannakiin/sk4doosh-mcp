import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";

import { AuthorizationDiscoveryService } from "../src/connections/authorization-discovery.service.ts";
import { ClientRegistrationService } from "../src/connections/client-registration.service.ts";
import { listTools } from "../src/connections/remote-mcp.client.ts";
import {
  BlockedAddressError,
  guardedOauthFetch,
} from "../src/connections/oauth-fetch.ts";
import { json, startStub, type Stub, type StubHandler, type StubReply } from "./oauth-stub.ts";

const CONFIG = {
  get: (key: string): unknown => {
    switch (key) {
      case "environment":
        return "development";
      case "pathPrefix":
        return "/api";
      case "auth":
        return { publicApiUrl: "http://127.0.0.1:5191" };
      default:
        return undefined;
    }
  },
};

let running: Stub | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function serve(handler: StubHandler): Promise<Stub> {
  running = await startStub(handler);

  return running;
}

async function services(): Promise<{
  discovery: AuthorizationDiscoveryService;
  registration: ClientRegistrationService;
}> {
  const module = await Test.createTestingModule({
    providers: [
      AuthorizationDiscoveryService,
      ClientRegistrationService,
      { provide: ConfigService, useValue: CONFIG },
    ],
  }).compile();

  return {
    discovery: module.get(AuthorizationDiscoveryService),
    registration: module.get(ClientRegistrationService),
  };
}

function metadata(origin: string, overrides: object = {}): unknown {
  return {
    issuer: `${origin}/`,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["orders.read", "orders.write"],
    ...overrides,
  };
}

function protectedResource(origin: string, overrides: object = {}): unknown {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [`${origin}/`],
    scopes_supported: ["orders.read"],
    ...overrides,
  };
}

function issuedClient(origin: string, overrides: object = {}): StubReply {
  return json(
    {
      client_id: "cid-1",
      client_secret: "s3cr3t",
      client_secret_expires_at: 0,
      registration_access_token: "rat-1",
      registration_client_uri: `${origin}/register/cid-1`,
      token_endpoint_auth_method: "client_secret_basic",
      ...overrides,
    },
    201,
  );
}

interface Routes {
  readonly challenge?: boolean;
  readonly cookie?: boolean;
  readonly oauthWellKnown?: (origin: string) => StubReply;
  readonly openidWellKnown?: (origin: string) => StubReply;
  readonly resource?: (origin: string) => StubReply;
  readonly register?: (origin: string) => StubReply;
}

function routes(options: Routes = {}): StubHandler {
  return (call, origin) => {
    if (call.path === "/mcp") {
      return options.challenge === false
        ? { status: 401 }
        : {
            status: 401,
            headers: {
              "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
            },
          };
    }

    if (call.path === "/.well-known/oauth-protected-resource/mcp") {
      const reply = (options.resource ?? ((at: string) => json(protectedResource(at))))(origin);

      return options.cookie === true
        ? {
            ...reply,
            headers: { ...reply.headers, "set-cookie": "sid=leak; Path=/" },
          }
        : reply;
    }

    if (call.path === "/.well-known/oauth-authorization-server") {
      return (options.oauthWellKnown ?? ((at: string) => json(metadata(at))))(origin);
    }

    if (call.path === "/.well-known/openid-configuration") {
      return options.openidWellKnown?.(origin) ?? { status: 404 };
    }

    if (call.path === "/moved") {
      return json(metadata(origin));
    }

    if (call.path === "/register") {
      return (options.register ?? issuedClient)(origin);
    }

    return { status: 404 };
  };
}

describe("probeAuthorization", () => {
  /**
   * Guard: the four situations this separates used to collapse into one value,
   * which is why a server that needs no authorization at all was reported
   * unreachable.
   */
  it("reports a server that answered with no challenge as open", async () => {
    const stub = await serve(() => ({ status: 200, body: "{}" }));
    const { discovery } = await services();

    await expect(
      discovery.probeAuthorization(`${stub.origin}/mcp`),
    ).resolves.toEqual({ kind: "open" });
  });

  it("reads the metadata url out of a challenge", async () => {
    const stub = await serve((_call, origin) => ({
      status: 401,
      headers: {
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      },
    }));
    const { discovery } = await services();

    await expect(
      discovery.probeAuthorization(`${stub.origin}/mcp`),
    ).resolves.toEqual({
      kind: "challenged",
      metadataUrl: `${stub.origin}/.well-known/oauth-protected-resource/mcp`,
    });
  });

  /**
   * Guard: a bare challenge names no metadata url and parses to `undefined`.
   * Reading that as "no challenge" would present a guarded server's tools with
   * no token at all.
   */
  it("treats a bare challenge as a challenge, not as an open server", async () => {
    const stub = await serve(() => ({
      status: 401,
      headers: { "www-authenticate": "Bearer" },
    }));
    const { discovery } = await services();

    await expect(
      discovery.probeAuthorization(`${stub.origin}/mcp`),
    ).resolves.toEqual({ kind: "challenged", metadataUrl: undefined });
  });

  it("does not call a server open because it refused the frame", async () => {
    const stub = await serve(() => ({ status: 404 }));
    const { discovery } = await services();

    await expect(
      discovery.probeAuthorization(`${stub.origin}/mcp`),
    ).resolves.toEqual({ kind: "challenged", metadataUrl: undefined });
  });

  it("reports an endpoint that never answered apart from one that refused", async () => {
    const stub = await serve(() => ({ status: 200 }));
    const origin = stub.origin;
    await stub.close();
    const { discovery } = await services();

    await expect(discovery.probeAuthorization(`${origin}/mcp`)).resolves.toEqual(
      { kind: "unanswered" },
    );
  });
});

describe("AuthorizationDiscoveryService", () => {
  it("follows the challenge to the resource and on to its authorization server", async () => {
    const stub = await serve(routes());
    const { discovery } = await services();

    const outcome = await discovery.discover(`${stub.origin}/mcp`);

    expect(outcome).toEqual({
      ok: true,
      metadataUrl: `${stub.origin}/.well-known/oauth-authorization-server`,
      resourceScopes: ["orders.read"],
      server: {
        issuer: `${stub.origin}/`,
        authorizationEndpoint: `${stub.origin}/authorize`,
        tokenEndpoint: `${stub.origin}/token`,
        registrationEndpoint: `${stub.origin}/register`,
        revocationEndpoint: undefined,
        scopesSupported: ["orders.read", "orders.write"],
      },
    });
  });

  it("falls back to the well-known path when the challenge names none", async () => {
    const stub = await serve(routes({ challenge: false }));
    const { discovery } = await services();

    const outcome = await discovery.discover(`${stub.origin}/mcp`);

    expect(outcome.ok).toBe(true);
  });

  /**
   * Guard: a metadata read carries no credential, so a redirect costs nothing to
   * follow — and a server that answers `301` to the canonical well-known path is
   * ordinary. The same hop on a token request is a credential handed elsewhere,
   * which is why only this direction follows.
   */
  it("follows a redirect on a metadata read", async () => {
    const stub = await serve(
      routes({
        oauthWellKnown: (origin) => ({
          status: 301,
          headers: { location: `${origin}/moved` },
        }),
      }),
    );
    const { discovery } = await services();

    const outcome = await discovery.discover(`${stub.origin}/mcp`);

    expect(outcome.ok).toBe(true);
  });

  it("tries the openid document when the oauth one is absent", async () => {
    const stub = await serve(
      routes({
        oauthWellKnown: () => ({ status: 404 }),
        openidWellKnown: (origin) => json(metadata(origin)),
      }),
    );
    const { discovery } = await services();

    const outcome = await discovery.discover(`${stub.origin}/mcp`);

    expect(outcome).toMatchObject({
      ok: true,
      metadataUrl: `${stub.origin}/.well-known/openid-configuration`,
    });
  });

  it("refuses a resource document that claims a different resource", async () => {
    const stub = await serve(
      routes({
        resource: (origin) =>
          json(protectedResource(origin, { resource: `${origin}/other` })),
      }),
    );
    const { discovery } = await services();

    await expect(discovery.discover(`${stub.origin}/mcp`)).resolves.toEqual({
      ok: false,
      failure: "resource_mismatch",
    });
  });

  it("refuses a server whose issuer is not where the document came from", async () => {
    const stub = await serve(
      routes({
        oauthWellKnown: (origin) =>
          json(metadata(origin, { issuer: "https://elsewhere.example/" })),
      }),
    );
    const { discovery } = await services();

    await expect(discovery.discover(`${stub.origin}/mcp`)).resolves.toEqual({
      ok: false,
      failure: "issuer_mismatch",
    });
  });

  it("refuses a server that offers no S256", async () => {
    const stub = await serve(
      routes({
        oauthWellKnown: (origin) =>
          json(metadata(origin, { code_challenge_methods_supported: ["plain"] })),
      }),
    );
    const { discovery } = await services();

    await expect(discovery.discover(`${stub.origin}/mcp`)).resolves.toEqual({
      ok: false,
      failure: "pkce_unsupported",
    });
  });

  it("refuses a server whose token endpoint is plain http off loopback", async () => {
    const stub = await serve(
      routes({
        oauthWellKnown: (origin) =>
          json(metadata(origin, { token_endpoint: "http://partner.example/token" })),
      }),
    );
    const { discovery } = await services();

    await expect(discovery.discover(`${stub.origin}/mcp`)).resolves.toEqual({
      ok: false,
      failure: "insecure_transport",
    });
  });

  it("refuses metadata that is not json", async () => {
    const stub = await serve(
      routes({
        oauthWellKnown: () => ({
          status: 200,
          headers: { "content-type": "application/json" },
          body: "<html>not json</html>",
        }),
      }),
    );
    const { discovery } = await services();

    await expect(discovery.discover(`${stub.origin}/mcp`)).resolves.toEqual({
      ok: false,
      failure: "malformed",
    });
  });

  it("refuses a server whose endpoints are not strings", async () => {
    const stub = await serve(
      routes({
        oauthWellKnown: (origin) => json(metadata(origin, { token_endpoint: 7 })),
      }),
    );
    const { discovery } = await services();

    await expect(discovery.discover(`${stub.origin}/mcp`)).resolves.toEqual({
      ok: false,
      failure: "malformed",
    });
  });

  it("refuses an address outside the public internet in production", async () => {
    const stub = await serve(routes());
    const module = await Test.createTestingModule({
      providers: [
        AuthorizationDiscoveryService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === "environment" ? "production" : undefined) },
        },
      ],
    }).compile();

    await expect(
      module.get(AuthorizationDiscoveryService).discover(`${stub.origin}/mcp`),
    ).resolves.toEqual({ ok: false, failure: "insecure_transport" });
  });
});

describe("ClientRegistrationService", () => {
  async function discovered(handler: StubHandler): Promise<{
    stub: Stub;
    registration: ClientRegistrationService;
    server: Awaited<ReturnType<AuthorizationDiscoveryService["discover"]>>;
  }> {
    const stub = await serve(handler);
    const { discovery, registration } = await services();

    return { stub, registration, server: await discovery.discover(`${stub.origin}/mcp`) };
  }

  it("registers a client and reads the issued values back", async () => {
    const { stub, registration, server } = await discovered(routes());
    if (!server.ok) {
      throw new Error("discovery failed");
    }

    const outcome = await registration.register(server.server, server.resourceScopes);

    expect(outcome).toEqual({
      kind: "registered",
      client: {
        clientId: "cid-1",
        clientSecret: "s3cr3t",
        clientSecretExpiresAt: undefined,
        registrationAccessToken: "rat-1",
        registrationClientUri: `${stub.origin}/register/cid-1`,
        tokenEndpointAuthMethod: "client_secret_basic",
        redirectUri: "http://127.0.0.1:5191/api/connections/callback",
      },
    });
  });

  it("sends the resource's scopes and this platform's callback", async () => {
    const { stub, registration, server } = await discovered(routes());
    if (!server.ok) {
      throw new Error("discovery failed");
    }

    await registration.register(server.server, server.resourceScopes);
    const sent = stub.calls.find(({ path }) => path === "/register");

    expect(JSON.parse(sent?.body ?? "{}")).toMatchObject({
      client_name: "Sk4doosh",
      redirect_uris: ["http://127.0.0.1:5191/api/connections/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "orders.read",
    });
  });

  it("registers a public client when the server issues no secret", async () => {
    const { registration, server } = await discovered(
      routes({
        register: (origin) =>
          issuedClient(origin, {
            client_secret: undefined,
            client_secret_expires_at: undefined,
            token_endpoint_auth_method: "none",
          }),
      }),
    );
    if (!server.ok) {
      throw new Error("discovery failed");
    }

    await expect(
      registration.register(server.server, server.resourceScopes),
    ).resolves.toMatchObject({
      kind: "registered",
      client: { clientSecret: undefined, tokenEndpointAuthMethod: "none" },
    });
  });

  it("reports the server's own refusal apart from a transport failure", async () => {
    const { registration, server } = await discovered(
      routes({
        register: () =>
          json({ error: "invalid_redirect_uri", error_description: "no" }, 400),
      }),
    );
    if (!server.ok) {
      throw new Error("discovery failed");
    }

    await expect(
      registration.register(server.server, server.resourceScopes),
    ).resolves.toEqual({ kind: "rejected", error: "invalid_redirect_uri" });
  });

  /**
   * Guard: the response headers reach the library, not just the body. An OAuth
   * error body is read only when the response declares `application/json`, so a
   * transport that dropped the header would report every refusal as an
   * unreachable server and retry a registration the server will never accept.
   */
  it("reads the refusal only when the server declares json", async () => {
    const { registration, server } = await discovered(
      routes({
        register: () => ({
          status: 400,
          headers: { "content-type": "text/plain" },
          body: JSON.stringify({ error: "invalid_redirect_uri" }),
        }),
      }),
    );
    if (!server.ok) {
      throw new Error("discovery failed");
    }

    await expect(
      registration.register(server.server, server.resourceScopes),
    ).resolves.toEqual({ kind: "refused", failure: "malformed" });
  });

  /**
   * Guard: the registration request carries no credential yet, but the response
   * does — and the same transport carries the token request, which does. A
   * redirected credential-bearing POST hands the client secret to whatever host
   * the response named.
   */
  it("does not follow a redirect from the registration endpoint", async () => {
    const { registration, server } = await discovered(
      routes({
        register: (origin) => ({
          status: 302,
          headers: { location: `${origin}/elsewhere` },
        }),
      }),
    );
    if (!server.ok) {
      throw new Error("discovery failed");
    }

    await expect(
      registration.register(server.server, server.resourceScopes),
    ).resolves.toEqual({ kind: "refused", failure: "unreachable" });
  });

  it("refuses a registration this platform could never use", async () => {
    const { registration, server } = await discovered(
      routes({
        register: (origin) =>
          issuedClient(origin, { token_endpoint_auth_method: "private_key_jwt" }),
      }),
    );
    if (!server.ok) {
      throw new Error("discovery failed");
    }

    await expect(
      registration.register(server.server, server.resourceScopes),
    ).resolves.toMatchObject({ kind: "unusable" });
  });

  it("reports a server that publishes no registration endpoint", async () => {
    const { registration, server } = await discovered(
      routes({
        oauthWellKnown: (origin) =>
          json(metadata(origin, { registration_endpoint: undefined })),
      }),
    );
    if (!server.ok) {
      throw new Error("discovery failed");
    }

    await expect(
      registration.register(server.server, server.resourceScopes),
    ).resolves.toEqual({ kind: "unsupported" });
  });
});

describe("guardedOauthFetch", () => {
  const policy = {
    endpoint: { allowLoopback: true },
    followRedirects: false,
    timeoutMs: 5_000,
    maxBytes: 64 * 1024,
  };

  it("drops a cookie a registrant-supplied server tried to set", async () => {
    const stub = await serve(routes({ cookie: true }));
    const response = await guardedOauthFetch(policy)(
      `${stub.origin}/.well-known/oauth-protected-resource/mcp`,
      { method: "GET", headers: {}, body: undefined },
    );

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("sends a form body with its own length", async () => {
    const stub = await serve(() => ({ status: 200 }));
    await guardedOauthFetch(policy)(`${stub.origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code" }),
    });

    expect(stub.calls[0]?.body).toBe("grant_type=authorization_code");
  });

  it("reports a refused address apart from an unreachable server", async () => {
    const strict = { ...policy, endpoint: { allowLoopback: false } };

    await expect(
      guardedOauthFetch(strict)("http://localhost:1/x", {
        method: "GET",
        headers: {},
        body: undefined,
      }),
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });
});

/**
 * Guard: gated on a url the operator supplies, because it needs a real MCP
 * server listening. The stub above pins the protocol; this pins the reading of
 * a server nobody in this repository wrote the responses for.
 */
const liveUrl = process.env.CHAT_E2E_MCP_URL;

const live = liveUrl === undefined ? describe.skip : describe;

live("against a running MCP server", () => {
  it("discovers its authorization server and registers a client there", async () => {
    const { discovery, registration } = await services();
    const outcome = await discovery.discover(liveUrl ?? "");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    expect(outcome.server.tokenEndpoint).toMatch(/^https?:\/\//u);

    const issued = await registration.register(
      outcome.server,
      outcome.resourceScopes,
    );

    expect(issued.kind).toBe("registered");
  });
});

/**
 * Guard: gated the same way, on a url for a server that asks for nothing. The
 * stub pins what this platform does with an open server; this pins that a real
 * one — `https://mcp.solana.com/mcp` is the one this was written against — is
 * still read as open rather than as unreachable, which is the defect the whole
 * of this path exists to have fixed.
 */
const publicUrl = process.env.CHAT_E2E_PUBLIC_MCP_URL;

const livePublic = publicUrl === undefined ? describe.skip : describe;

livePublic("against a running public MCP server", () => {
  it("reads it as open and lists its tools with no token", async () => {
    const { discovery } = await services();

    await expect(
      discovery.probeAuthorization(publicUrl ?? ""),
    ).resolves.toEqual({ kind: "open" });

    const listed = await listTools({
      url: publicUrl ?? "",
      accessToken: undefined,
      endpoint: { allowLoopback: false },
      timeoutMs: 15_000,
      maxBytes: 256 * 1024,
    });

    expect(listed.kind).toBe("ok");
    expect(listed.kind === "ok" ? listed.value.length : 0).toBeGreaterThan(0);
  });
});
