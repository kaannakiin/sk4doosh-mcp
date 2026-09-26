import "reflect-metadata";
import {
  All,
  Controller,
  Req,
  Res,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { McpServer } from "@modelcontextprotocol/server";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/express";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { Request, Response } from "express";
import { defaultProtocolRevision, protocolRevisions } from "@liaiso/core";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it } from "vitest";
import {
  LiaisoModule,
  LiaisoStreamableHttp,
  type LiaisoOptions,
  type LiaisoRequestHandler,
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

/**
 * Guard: the legacy leg of `createMcpHandler` builds its transport with `sessionIdGenerator:
 * undefined` and nothing else, so it answers a 2025-era POST as an SSE frame rather than the bare
 * JSON body the hand-wired `enableJsonResponse: true` transport used to return.
 */
function frameOf(body: string): unknown {
  const line = body
    .split("\n")
    .find((candidate) => candidate.startsWith("data:"));
  return JSON.parse((line ?? body).replace(/^data:\s*/u, ""));
}

@Controller()
class TransportProbeController {
  private readonly serve: LiaisoRequestHandler;

  constructor(private readonly streamableHttp: LiaisoStreamableHttp) {
    this.serve = this.streamableHttp.serve(() => {
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

  @All("mcp")
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.serve(req, res);
  }
}

interface TransportTestApp {
  app: INestApplication;
  baseUrl: string;
  close(): Promise<void>;
}

async function createTransportApp(
  configure: (options: LiaisoOptions) => void,
): Promise<TransportTestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [LiaisoModule.forRoot(configure)],
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
          protocolVersion: defaultProtocolRevision,
          capabilities: {},
          clientInfo: { name: "probe", version: "0.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = frameOf(await res.text()) as {
      jsonrpc: string;
      result?: { protocolVersion?: string };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(protocolRevisions).toContain(body.result?.protocolVersion);
    expect(body.result?.protocolVersion).not.toBe(defaultProtocolRevision);
  });

  it("N5: a negotiating client receives a catalogue change over subscriptions/listen", async () => {
    current = await createTransportApp(() => {});

    let notified = 0;
    const client = new Client(
      { name: "test-client", version: "0.0.0" },
      {
        versionNegotiation: { mode: "auto" },
        listChanged: {
          tools: {
            autoRefresh: false,
            debounceMs: 0,
            onChanged: () => {
              notified += 1;
            },
          },
        },
      },
    );

    const clientTransport = new StreamableHTTPClientTransport(
      new URL(`${current.baseUrl}/mcp`),
    );
    await client.connect(clientTransport);
    expect(client.getProtocolEra()).toBe("modern");

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "ping")).toBe(true);

    current.app.get(LiaisoStreamableHttp).notifyToolListChanged();
    await waitFor(() => notified > 0);

    await client.close();
  });

  it("N6: a 2025-era request still gets 405 on GET and DELETE", async () => {
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
