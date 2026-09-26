import { All, Controller, Inject, Req, Res } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/server";
import {
  CallerVisibilityProvider,
  extensionTokens,
  registerLiaisoTools,
  LiaisoCatalog,
  LiaisoDispatcher,
  LiaisoStreamableHttp,
  LIAISO_OPTIONS,
  type CallerScopeResolver,
  type InvokeResultMapper,
  type LiaisoOptions,
  type LiaisoRequestHandler,
} from "@liaiso/sdk-nestjs";
import type { Request, Response } from "express";

@Controller()
export class McpController {
  constructor(
    private readonly streamableHttp: LiaisoStreamableHttp,
    private readonly catalog: LiaisoCatalog,
    private readonly dispatcher: LiaisoDispatcher,
    private readonly visibility: CallerVisibilityProvider,
    @Inject(extensionTokens.invokeResultMapper)
    private readonly mapper: InvokeResultMapper,
    @Inject(extensionTokens.callerScopeResolver)
    private readonly scopes: CallerScopeResolver,
    @Inject(LIAISO_OPTIONS) private readonly options: LiaisoOptions,
  ) {
    this.serve = this.streamableHttp.serve(() => {
      const server = new McpServer({ name: "demo-api", version: "0.0.0" });
      registerLiaisoTools(server, {
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

  private readonly serve: LiaisoRequestHandler;

  @All("mcp")
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.serve(req, res);
  }
}
