import { All, Controller, Inject, Req, Res } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/server";
import {
  CallerVisibilityProvider,
  extensionTokens,
  registerSkMcpTools,
  SkMcpCatalog,
  SkMcpDispatcher,
  SkMcpStreamableHttp,
  SK_MCP_OPTIONS,
  type CallerScopeResolver,
  type InvokeResultMapper,
  type SkMcpOptions,
  type SkMcpRequestHandler,
} from "@sk-mcp/sdk-nestjs";
import type { Request, Response } from "express";

@Controller()
export class McpController {
  constructor(
    private readonly streamableHttp: SkMcpStreamableHttp,
    private readonly catalog: SkMcpCatalog,
    private readonly dispatcher: SkMcpDispatcher,
    private readonly visibility: CallerVisibilityProvider,
    @Inject(extensionTokens.invokeResultMapper)
    private readonly mapper: InvokeResultMapper,
    @Inject(extensionTokens.callerScopeResolver)
    private readonly scopes: CallerScopeResolver,
    @Inject(SK_MCP_OPTIONS) private readonly options: SkMcpOptions,
  ) {
    this.serve = this.streamableHttp.serve(() => {
      const server = new McpServer({ name: "demo-api", version: "0.0.0" });
      registerSkMcpTools(server, {
        catalog: this.catalog,
        dispatcher: this.dispatcher,
        mapper: this.mapper,
        visibility: this.visibility,
        scopes: this.scopes,
        options: this.options,
      });
      return server;
    });
  }

  private readonly serve: SkMcpRequestHandler;

  @All("mcp")
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.serve(req, res);
  }
}
