import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { extensionTokens } from "../extension-points.js";
import { SK_MCP_OPTIONS, SkMcpOptions } from "../options.js";
import type { SkMcpSessionStore } from "./session-store.js";

export type SkMcpServerFactory = () => McpServer;

const statefulKeepAliveMs = 30_000;

function sessionIdFromHeader(req: Request): string | undefined {
  const value = req.headers["mcp-session-id"];
  return typeof value === "string" ? value : undefined;
}

@Injectable()
export class SkMcpStreamableHttp {
  constructor(
    @Inject(SK_MCP_OPTIONS) private readonly options: SkMcpOptions,
    @Inject(extensionTokens.sessionStore)
    private readonly sessions: SkMcpSessionStore,
  ) {}

  async handle(
    req: Request,
    res: Response,
    createServer: SkMcpServerFactory,
  ): Promise<void> {
    if (this.options.transport.sessionMode === "stateless") {
      await this.handleStateless(req, res, createServer);
      return;
    }
    await this.handleStateful(req, res, createServer);
  }

  notifyToolListChanged(): void {
    for (const entry of this.sessions.values()) {
      entry.server.sendToolListChanged();
    }
  }

  private async handleStateless(
    req: Request,
    res: Response,
    createServer: SkMcpServerFactory,
  ): Promise<void> {
    if (req.method === "GET" || req.method === "DELETE") {
      res
        .status(405)
        .json({ error: "stateless transport does not support GET or DELETE" });
      return;
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  private async handleStateful(
    req: Request,
    res: Response,
    createServer: SkMcpServerFactory,
  ): Promise<void> {
    const sessionId = sessionIdFromHeader(req);

    if (sessionId !== undefined) {
      const entry = this.sessions.get(sessionId);
      if (entry === undefined) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      await entry.transport.handleRequest(
        req,
        res,
        req.method === "POST" ? req.body : undefined,
      );
      return;
    }

    if (req.method !== "POST") {
      res
        .status(400)
        .json({ error: "Bad Request: Mcp-Session-Id header is required" });
      return;
    }

    const server = createServer();
    const transport: StreamableHTTPServerTransport =
      new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: false,
        keepAliveMs: statefulKeepAliveMs,
        onsessioninitialized: (id) => {
          this.sessions.set(id, { server, transport });
        },
        onsessionclosed: (id) => {
          this.sessions.delete(id);
        },
      });
    res.on("close", () => {
      if (transport.sessionId === undefined) {
        void transport.close().catch(() => undefined);
        void server.close().catch(() => undefined);
      }
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
