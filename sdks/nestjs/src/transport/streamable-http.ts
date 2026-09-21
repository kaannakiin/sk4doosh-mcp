import { Injectable } from "@nestjs/common";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { Request, Response } from "express";
import { connectionOf, runWithOuterConnection } from "../outer-connection.js";

export type SkMcpServerFactory = () => McpServer;

export type SkMcpRequestHandler = (
  req: Request,
  res: Response,
) => Promise<void>;

interface ServedEndpoint {
  readonly dispatch: SkMcpRequestHandler;
  readonly notifyToolsChanged: () => void;
}

/**
 * Serves the MCP endpoint over Streamable HTTP on both protocol eras.
 *
 * The 2026-07-28 revision has no sessions and no `Mcp-Session-Id`, so there is nothing to store
 * between requests: `createMcpHandler` builds one server per exchange from the factory, and its
 * `legacy: 'stateless'` default answers 2025-era traffic the same way. A catalogue change reaches
 * clients through the handler's `subscriptions/listen` bus rather than an unsolicited broadcast,
 * which is the only delivery the 2026 revision has.
 */
@Injectable()
export class SkMcpStreamableHttp {
  private readonly served: ServedEndpoint[] = [];

  /**
   * Binds one endpoint to a server factory and returns its request handler.
   *
   * Guard: call this once per endpoint and keep the result — the handler owns the change-event bus
   * every open `subscriptions/listen` stream is attached to, so building a fresh one per request
   * would leave every subscriber listening to a bus nobody publishes on.
   */
  serve(createServer: SkMcpServerFactory): SkMcpRequestHandler {
    const handler = createMcpHandler(createServer);
    const dispatchNode = toNodeHandler(handler);
    const dispatch: SkMcpRequestHandler = async (req, res) =>
      runWithOuterConnection(connectionOf(req), async () => {
        await dispatchNode(req, res, req.body);
      });
    this.served.push({
      dispatch,
      notifyToolsChanged: () => {
        handler.notify.toolsChanged();
      },
    });
    return dispatch;
  }

  notifyToolListChanged(): void {
    for (const endpoint of this.served) {
      endpoint.notifyToolsChanged();
    }
  }
}
