import { Controller, Post, Req, Res } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SkMcpDispatcher } from "@sk-mcp/sdk-nestjs";
import type { Request, Response } from "express";
import { registerOrderTools } from "./order-tools.js";

@Controller()
export class McpController {
  constructor(private readonly dispatcher: SkMcpDispatcher) {}

  @Post("mcp")
  async handle(@Req() request: Request, @Res() response: Response) {
    const server = new McpServer({ name: "demo-api", version: "0.0.0" });
    registerOrderTools(server, this.dispatcher, request);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  }
}
