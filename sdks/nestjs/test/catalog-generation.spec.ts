import "reflect-metadata";
import {
  All,
  Controller,
  Get,
  Req,
  Res,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CallerScopeResolver } from "../src/cache.js";
import { SkMcpCatalog } from "../src/catalog.js";
import { McpTool } from "../src/decorators.js";
import { SkMcpDispatcher } from "../src/dispatcher.js";
import { extensionTokens } from "../src/extension-points.js";
import type { InvokeResultMapper } from "../src/invoke-result-mapper.js";
import {
  catalogGenerationMetaKey,
  registerSkMcpTools,
} from "../src/meta-tools.js";
import { SK_MCP_OPTIONS, type SkMcpOptions } from "../src/options.js";
import { SkMcpModule } from "../src/sk-mcp.module.js";
import { SkMcpStreamableHttp } from "../src/transport/streamable-http.js";
import { CallerVisibilityProvider } from "../src/visibility/provider.js";

interface Connected {
  ip?: string;
  socket: { remoteAddress?: string; remotePort?: number };
}

@Controller()
@McpTool()
class EchoController {
  @Get("whoami")
  whoami(@Req() req: Request): {
    ip: string | undefined;
    remoteAddress: string | undefined;
    remotePort: number | undefined;
  } {
    const connected = req as unknown as Connected;
    return {
      ip: connected.ip,
      remoteAddress: connected.socket.remoteAddress,
      remotePort: connected.socket.remotePort,
    };
  }
}

let mapper: InvokeResultMapper | undefined;
let scopes: CallerScopeResolver | undefined;
let options: SkMcpOptions | undefined;

@Controller()
class GenerationMcpController {
  constructor(
    private readonly streamableHttp: SkMcpStreamableHttp,
    private readonly catalog: SkMcpCatalog,
    private readonly dispatcher: SkMcpDispatcher,
    private readonly visibility: CallerVisibilityProvider,
  ) {}

  @All("mcp")
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.streamableHttp.handle(req, res, () => {
      const server = new McpServer({ name: "generation", version: "0.0.0" });
      registerSkMcpTools(server, {
        catalog: this.catalog,
        dispatcher: this.dispatcher,
        mapper: mapper as InvokeResultMapper,
        visibility: this.visibility,
        scopes: scopes as CallerScopeResolver,
        options: options as SkMcpOptions,
      });
      return server;
    });
  }
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

describe("nest catalog generation and connection reflection", () => {
  let app: INestApplication;
  let baseUrl: string;
  let catalog: SkMcpCatalog;
  let client: Client;
  let notifications = 0;

  const generationsOf = async (): Promise<number[]> => {
    const listed = await client.listTools();
    return listed.tools.map(
      (tool) => (tool._meta ?? {})[catalogGenerationMetaKey] as number,
    );
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        SkMcpModule.forRoot((opts) => {
          opts.transport.sessionMode = "stateful";
        }),
      ],
      controllers: [EchoController, GenerationMcpController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();

    catalog = app.get(SkMcpCatalog);
    mapper = app.get<InvokeResultMapper>(extensionTokens.invokeResultMapper);
    scopes = app.get<CallerScopeResolver>(extensionTokens.callerScopeResolver);
    options = app.get<SkMcpOptions>(SK_MCP_OPTIONS);

    client = new Client({ name: "generation-probe", version: "0.0.0" });
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notifications += 1;
    });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)),
    );
  });

  afterAll(async () => {
    await client.close();
    await app.close();
  });

  it("G1: every meta-tool carries the catalog generation in _meta", async () => {
    const generations = await generationsOf();
    expect(generations.length).toBe(3);
    for (const generation of generations) {
      expect(generation).toBe(catalog.generation);
    }
  });

  it("G2: a catalog reload restamps the live session and notifies it once", async () => {
    const before = await generationsOf();
    const notifiedBefore = notifications;

    catalog.reload();
    await waitFor(() => notifications > notifiedBefore);

    const after = await generationsOf();
    expect(after.every((generation) => generation === catalog.generation)).toBe(
      true,
    );
    expect(Math.min(...after)).toBeGreaterThan(Math.max(...before));
    expect(notifications - notifiedBefore).toBe(1);
  });

  it("G3: the synthetic request reflects the outer connection", async () => {
    const name = [...catalog.current.byName.keys()].find((candidate) =>
      candidate.endsWith("whoami"),
    );
    expect(name).toBeDefined();

    const result = (await client.callTool({
      name: "invoke_tool",
      arguments: { name, arguments: {} },
    })) as unknown as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);
    const outcome = JSON.parse(result.content[0]?.text ?? "{}") as {
      body?: { ip?: string; remoteAddress?: string; remotePort?: number };
    };
    const echoed = outcome.body ?? {};
    expect(echoed.remoteAddress).toBeDefined();
    expect(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).toContain(
      echoed.remoteAddress,
    );
    expect(echoed.ip).toBe(echoed.remoteAddress);
    expect(typeof echoed.remotePort).toBe("number");
  });
});
