import { describe, expect, it } from "vitest";

import { authorizationServerMetadataSchema } from "../src/integration/authorization-metadata.ts";
import {
  authorizationServerMetadataUrls,
  defaultResourceMetadataUrl,
  isSecureEndpoint,
  resourceMetadataUrlFrom,
  verifyAuthorizationServer,
  verifyProtectedResource,
} from "../src/integration/discovery.ts";

const metadata = authorizationServerMetadataSchema.parse({
  issuer: "https://partner.example/",
  authorization_endpoint: "https://partner.example/authorize",
  token_endpoint: "https://partner.example/token",
  registration_endpoint: "https://partner.example/register",
  code_challenge_methods_supported: ["S256"],
});

const local = { allowLoopback: true };

describe("isSecureEndpoint", () => {
  it("accepts https to a public host", () => {
    expect(isSecureEndpoint("https://partner.example/mcp")).toBe(true);
  });

  it("refuses plain http", () => {
    expect(isSecureEndpoint("http://partner.example/mcp")).toBe(false);
  });

  it("refuses https to cloud instance metadata", () => {
    expect(isSecureEndpoint("https://169.254.169.254/mcp")).toBe(false);
  });

  it("refuses https to a private network address", () => {
    expect(isSecureEndpoint("https://10.0.0.5/mcp")).toBe(false);
    expect(isSecureEndpoint("https://192.168.1.1/mcp")).toBe(false);
  });

  it("refuses loopback unless the caller states the policy", () => {
    expect(isSecureEndpoint("http://127.0.0.1:3000/mcp")).toBe(false);
    expect(isSecureEndpoint("https://localhost:3000/mcp")).toBe(false);
    expect(isSecureEndpoint("http://127.0.0.1:3000/mcp", local)).toBe(true);
    expect(isSecureEndpoint("http://localhost:3000/mcp", local)).toBe(true);
  });

  it("refuses a value that is not a url", () => {
    expect(isSecureEndpoint("partner.example/mcp")).toBe(false);
  });
});

describe("resourceMetadataUrlFrom", () => {
  it("reads the url a challenge named", () => {
    expect(
      resourceMetadataUrlFrom(
        'Bearer error="invalid_token", resource_metadata="https://partner.example/.well-known/oauth-protected-resource/mcp"',
      ),
    ).toBe("https://partner.example/.well-known/oauth-protected-resource/mcp");
  });

  it("reports nothing when the challenge named none", () => {
    expect(resourceMetadataUrlFrom("Bearer")).toBeUndefined();
    expect(resourceMetadataUrlFrom(undefined)).toBeUndefined();
  });
});

describe("defaultResourceMetadataUrl", () => {
  it("inserts the well-known segment after the host and keeps the path as a suffix", () => {
    expect(defaultResourceMetadataUrl("https://partner.example/mcp")).toBe(
      "https://partner.example/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("omits the suffix for a resource mounted at the root", () => {
    expect(defaultResourceMetadataUrl("https://partner.example/")).toBe(
      "https://partner.example/.well-known/oauth-protected-resource",
    );
  });
});

describe("authorizationServerMetadataUrls", () => {
  it("tries the oauth document before the openid one", () => {
    expect(authorizationServerMetadataUrls("https://partner.example/")).toEqual([
      "https://partner.example/.well-known/oauth-authorization-server",
      "https://partner.example/.well-known/openid-configuration",
    ]);
  });

  it("carries an issuer path as a suffix and adds the openid path form", () => {
    expect(
      authorizationServerMetadataUrls("https://partner.example/tenant/7"),
    ).toEqual([
      "https://partner.example/.well-known/oauth-authorization-server/tenant/7",
      "https://partner.example/.well-known/openid-configuration/tenant/7",
      "https://partner.example/tenant/7/.well-known/openid-configuration",
    ]);
  });
});

describe("verifyProtectedResource", () => {
  it("accepts a document that claims the resource that was asked about", () => {
    expect(
      verifyProtectedResource("https://partner.example/mcp", {
        resource: "https://partner.example/mcp",
        authorization_servers: ["https://partner.example/"],
      }),
    ).toBe(true);
  });

  it("refuses a document that claims a different resource", () => {
    expect(
      verifyProtectedResource("https://partner.example/mcp", {
        resource: "https://elsewhere.example/mcp",
        authorization_servers: ["https://elsewhere.example/"],
      }),
    ).toBe(false);
  });
});

describe("verifyAuthorizationServer", () => {
  it("accepts a server whose issuer matches where the document came from", () => {
    const result = verifyAuthorizationServer("https://partner.example/", metadata);

    expect(result).toEqual({
      ok: true,
      server: {
        issuer: "https://partner.example/",
        authorizationEndpoint: "https://partner.example/authorize",
        tokenEndpoint: "https://partner.example/token",
        registrationEndpoint: "https://partner.example/register",
        revocationEndpoint: undefined,
        scopesSupported: [],
      },
    });
  });

  it("refuses a server claiming an issuer it was not fetched from", () => {
    expect(
      verifyAuthorizationServer("https://partner.example/", {
        ...metadata,
        issuer: "https://attacker.example/",
      }),
    ).toEqual({ ok: false, failure: "issuer_mismatch" });
  });

  it("refuses a server whose token endpoint is plain http", () => {
    expect(
      verifyAuthorizationServer("https://partner.example/", {
        ...metadata,
        token_endpoint: "http://partner.example/token",
      }),
    ).toEqual({ ok: false, failure: "insecure_transport" });
  });

  it("refuses a server that offers no S256, rather than falling back to plain", () => {
    expect(
      verifyAuthorizationServer("https://partner.example/", {
        ...metadata,
        code_challenge_methods_supported: ["plain"],
      }),
    ).toEqual({ ok: false, failure: "pkce_unsupported" });

    expect(
      verifyAuthorizationServer("https://partner.example/", {
        ...metadata,
        code_challenge_methods_supported: undefined,
      }),
    ).toEqual({ ok: false, failure: "pkce_unsupported" });
  });
});
