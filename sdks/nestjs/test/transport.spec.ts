import "reflect-metadata";
import {
  All,
  Controller,
  Req,
  Res,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it } from "vitest";
import {
  extensionTokens,
  SkMcpModule,
  SkMcpStreamableHttp,
  type SkMcpOptions,
  type SkMcpSessionStore,
} from "../src/index.js";

const secret = "transport-test-secret-0123456789abcdef";
const resource = new URL("https://api.example.com/mcp");
const issuer = new URL("https://auth.example.com");

function mintToken(audience: string): string {
  return jwt.sign({ sub: "alice" }, secret, { expiresIn: 3600, audience });
}

function verifier(): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string) {
      const payload = jwt.verify(token, secret) as jwt.JwtPayload;
      return {
        token,
        clientId: "test-client",
        scopes: [],
        expiresAt: payload.exp,
        resource: new URL(String(payload.aud)),
      };
    },
  };
}

@Controller()
class TransportProbeController {
  constructor(private readonly streamableHttp: SkMcpStreamableHttp) {}

  @All("mcp")
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.streamableHttp.handle(req, res, () => {
      const server = new McpServer({
        name: "transport-test",
        version: "0.0.0",
      });
      server.registerTool("ping", { description: "ping" }, async () => ({
        content: [{ type: "text" as const, text: "pong" }],
      }));
      return server;
    });
  }
}

interface TransportTestApp {
  app: INestApplication;
  baseUrl: string;
  close(): Promise<void>;
}

async function createTransportApp(
  configure: (options: SkMcpOptions) => void,
): Promise<TransportTestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [SkMcpModule.forRoot(configure)],
    controllers: [TransportProbeController],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  await app.listen(0);
  const baseUrl = await app.getUrl();
  return { app, baseUrl, close: () => app.close() };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let current: TransportTestApp | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe("Nest streamable HTTP transport", () => {
  it("N1: PRM is served in RFC 9728 shape when resourceServer is configured", async () => {
    current = await createTransportApp((options) => {
      options.resourceServer = {
        resource,
        authorizationServers: [issuer],
        resourceName: "transport-test",
        verifier: verifier(),
      };
    });

    const res = await fetch(
      `${current.baseUrl}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["resource"]).toBe(resource.toString());
    expect(body["authorization_servers"]).toEqual([issuer.toString()]);
    expect(body["bearer_methods_supported"]).toEqual(["header"]);
    expect(body["resource_name"]).toBe("transport-test");
  });

  it("N2: a missing bearer on /mcp yields 401 with resource_metadata in WWW-Authenticate", async () => {
    current = await createTransportApp((options) => {
      options.resourceServer = {
        resource,
        authorizationServers: [issuer],
        verifier: verifier(),
      };
    });

    const res = await fetch(`${current.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const header = res.headers.get("www-authenticate");
    expect(header).toContain("resource_metadata=");
    expect(header).toContain("/.well-known/oauth-protected-resource/mcp");
  });

  it("N3: a token minted for a different audience is rejected", async () => {
    current = await createTransportApp((options) => {
      options.resourceServer = {
        resource,
        authorizationServers: [issuer],
        verifier: verifier(),
      };
    });

    const token = mintToken("https://not-the-resource.example.com/mcp");
    const res = await fetch(`${current.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("N4: without resourceServer, PRM is absent and /mcp is reachable without a bearer", async () => {
    current = await createTransportApp(() => {});

    const prm = await fetch(
      `${current.baseUrl}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(prm.status).toBe(404);

    const res = await fetch(`${current.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "probe", version: "0.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jsonrpc: string };
    expect(body.jsonrpc).toBe("2.0");
  });

  it("N5: a stateful session survives across requests, receives list_changed, and DELETE terminates it", async () => {
    current = await createTransportApp((options) => {
      options.transport.sessionMode = "stateful";
    });

    const client = new Client({ name: "test-client", version: "0.0.0" });
    let notified = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notified += 1;
    });

    const clientTransport = new StreamableHTTPClientTransport(
      new URL(`${current.baseUrl}/mcp`),
    );
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "ping")).toBe(true);

    const sessions = current.app.get<SkMcpSessionStore>(
      extensionTokens.sessionStore,
    );
    expect([...sessions.values()].length).toBe(1);

    current.app.get(SkMcpStreamableHttp).notifyToolListChanged();
    await waitFor(() => notified > 0);

    await clientTransport.terminateSession();
    expect([...sessions.values()].length).toBe(0);

    await client.close();
  });

  it("N6: a stateless transport rejects GET and DELETE with 405", async () => {
    current = await createTransportApp(() => {});

    const get = await fetch(`${current.baseUrl}/mcp`, {
      method: "GET",
      headers: { accept: "text/event-stream" },
    });
    expect(get.status).toBe(405);

    const del = await fetch(`${current.baseUrl}/mcp`, { method: "DELETE" });
    expect(del.status).toBe(405);
  });
});
