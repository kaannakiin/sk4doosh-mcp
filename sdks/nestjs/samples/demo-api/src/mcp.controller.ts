import { All, Controller, Inject, Req, Res } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  extensionTokens,
  SkMcpDispatcher,
  SkMcpStreamableHttp,
  type InvokeResultMapper,
} from "@sk-mcp/sdk-nestjs";
import type { Request, Response } from "express";
import { registerOrderTools } from "./order-tools.js";

@Controller()
export class McpController {
  constructor(
    private readonly streamableHttp: SkMcpStreamableHttp,
    private readonly dispatcher: SkMcpDispatcher,
    @Inject(extensionTokens.invokeResultMapper)
    private readonly mapper: InvokeResultMapper,
  ) {}

  @All("mcp")
  async handle(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.streamableHttp.handle(request, response, () => {
      const server = new McpServer({ name: "demo-api", version: "0.0.0" });
      registerOrderTools(server, this.dispatcher, this.mapper);
      return server;
    });
  }
}
