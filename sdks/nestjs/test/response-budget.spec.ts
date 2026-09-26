import "reflect-metadata";
import {
  All,
  Controller,
  Get,
  Query,
  Req,
  Res,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { McpServer } from "@modelcontextprotocol/server";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { Request, Response } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SdkError } from "@liaiso/core";
import type { CallerScopeResolver } from "../src/cache.js";
import { LiaisoCatalog } from "../src/catalog.js";
import { McpTool } from "../src/decorators.js";
import { LiaisoDispatcher } from "../src/dispatcher.js";
import { extensionTokens } from "../src/extension-points.js";
import type { InvokeResultMapper } from "../src/invoke-result-mapper.js";
import { registerLiaisoTools } from "../src/meta-tools.js";
import { LIAISO_OPTIONS, type LiaisoOptions } from "../src/options.js";
import { LiaisoModule } from "../src/liaiso.module.js";
import {
  LiaisoStreamableHttp,
  type LiaisoRequestHandler,
} from "../src/transport/streamable-http.js";
import { CallerVisibilityProvider } from "../src/visibility/provider.js";

@Controller()
class BulkController {
  @Get("rows")
  @McpTool({ name: "list_rows" })
  rows(@Query("limit") limit?: string) {
    const count = Number(limit ?? "1");
    return Array.from({ length: count }, (_value, index) => ({
      id: index,
      note: "x".repeat(64),
    }));
  }

  @Get("slow")
  @McpTool({ name: "slow_call" })
  slow(@Res() res: Response) {
    setTimeout(() => res.json({ eventually: true }), 5_000);
    return undefined;
  }

  @Get("exact")
  @McpTool({ name: "exact_size" })
  exact(@Query("pad") pad?: string) {
    return { pad: "y".repeat(Number(pad ?? "0")) };
  }
}

interface Wire {
  readonly content: { readonly type: string; readonly text: string }[];
  readonly isError?: boolean;
}

let mapper: InvokeResultMapper | undefined;
let scopes: CallerScopeResolver | undefined;
let options: LiaisoOptions | undefined;

@Controller()
class BudgetMcpController {
  private readonly serve: LiaisoRequestHandler;

  constructor(
    private readonly streamableHttp: LiaisoStreamableHttp,
    private readonly catalog: LiaisoCatalog,
    private readonly dispatcher: LiaisoDispatcher,
    private readonly visibility: CallerVisibilityProvider,
  ) {
    this.serve = this.streamableHttp.serve(() => {
      const server = new McpServer({ name: "budget", version: "0.0.0" });
      registerLiaisoTools(server, {
        catalog: this.catalog,
        dispatcher: this.dispatcher,
        mapper: mapper as InvokeResultMapper,
        visibility: this.visibility,
        scopes: scopes as CallerScopeResolver,
        options: options as LiaisoOptions,
      });
      return server;
    });
  }

  @All("mcp")
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.serve(req, res);
  }
}

describe("response budget and invoke deadline", () => {
  let app: INestApplication;
  let client: Client;

  const call = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ parsed: SdkError; isError: boolean }> => {
    const result = (await client.callTool({
      name,
      arguments: args,
    })) as unknown as Wire;
    return {
      parsed: JSON.parse(result.content[0]?.text ?? "{}") as SdkError,
      isError: result.isError === true,
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LiaisoModule.forRoot((opts) => {
          opts.invoke.maxResponseBytes = 4_096;
          opts.invoke.timeoutMs = 150;
        }),
      ],
      controllers: [BulkController, BudgetMcpController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0);

    mapper = app.get<InvokeResultMapper>(extensionTokens.invokeResultMapper);
    scopes = app.get<CallerScopeResolver>(extensionTokens.callerScopeResolver);
    options = app.get<LiaisoOptions>(LIAISO_OPTIONS);

    client = new Client({ name: "budget-probe", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${await app.getUrl()}/mcp`)),
    );
  });

  afterAll(async () => {
    await client.close();
    await app.close();
  });

  it("B1 refuses an oversize response and names the narrowing arguments", async () => {
    const { parsed, isError } = await call("invoke_tool", {
      name: "list_rows",
      arguments: { limit: "200" },
    });
    expect(isError).toBe(true);
    expect(parsed.error).toBe("response_too_large");
    expect(parsed.retryable).toBe(false);
    expect(parsed.payload?.limit).toBe(4_096);
    expect(parsed.payload?.bytes).toBeGreaterThan(4_096);
    expect(parsed.payload?.shape).toEqual({ kind: "array", count: 200 });
    expect(parsed.fields?.map((field) => field.name)).toContain("limit");
    expect(parsed.message).not.toContain("xxxx");
  });

  it("B2 admits a response that fits and refuses one byte over", async () => {
    const fits = await call("invoke_tool", {
      name: "exact_size",
      arguments: { pad: "1000" },
    });
    expect(fits.isError).toBe(false);

    const over = await call("invoke_tool", {
      name: "exact_size",
      arguments: { pad: "8000" },
    });
    expect(over.isError).toBe(true);
    expect(over.parsed.error).toBe("response_too_large");
  });

  it("B3 lets a per-endpoint override lower the budget for one tool alone", async () => {
    const live = options as LiaisoOptions;
    live.invoke.maxResponseBytesFor = (target) =>
      target.tool === "exact_size" ? 32 : undefined;
    try {
      const overridden = await call("invoke_tool", {
        name: "exact_size",
        arguments: { pad: "100" },
      });
      expect(overridden.isError).toBe(true);
      expect(overridden.parsed.error).toBe("response_too_large");
      expect(overridden.parsed.payload?.limit).toBe(32);

      const untouched = await call("invoke_tool", {
        name: "list_rows",
        arguments: { limit: "2" },
      });
      expect(untouched.isError).toBe(false);
    } finally {
      live.invoke.maxResponseBytesFor = undefined;
    }
  });

  it("B4 answers a deadline expiry with invoke_timeout", async () => {
    const { parsed, isError } = await call("invoke_tool", {
      name: "slow_call",
      arguments: {},
    });
    expect(isError).toBe(true);
    expect(parsed.error).toBe("invoke_timeout");
    expect(parsed.retryable).toBe(true);
    expect(parsed.message).toContain("150 ms");
  });

  it("B5 never forwards a raw throw from inside the layer", async () => {
    const { parsed, isError } = await call("invoke_tool", {
      name: "list_rows",
      arguments: { limit: { nested: true } },
    });
    expect(isError).toBe(true);
    expect(parsed.message).not.toMatch(/\/Users\//);
    expect(parsed.message).not.toMatch(/\bat \w+\./);
  });
});
