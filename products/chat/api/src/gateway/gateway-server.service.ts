import { callToolInputSchema } from "@chat/contracts/tools/discovery/call-tool";
import { findToolsInputSchema } from "@chat/contracts/tools/discovery/find-tools";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { I18nService } from "../i18n/i18n.service.ts";
import { GatewayCallsService } from "./gateway-calls.service.ts";
import type { GatewayTurn } from "./gateway-turn.ts";
import { GrantRegistry } from "./grant-registry.ts";

export const GATEWAY_SERVER = "gateway";

const GATEWAY_PATH = "/mcp";

const LOOPBACK = "127.0.0.1";

/**
 * The one MCP server every agent thread is given: two tools that reach the
 * conversation's readers, local worker and connected servers through this
 * process.
 *
 * Guard: it listens on the loopback interface, on a port the kernel picks, and
 * it is never the api's own port. Codex's MCP client runs in the app-server
 * process, outside the command sandbox, while the agent's shell is sandboxed
 * with networking off — measured on 0.154, `curl 127.0.0.1:<port>` from inside
 * it exits 7 — so the only caller that can reach this is codex holding a grant.
 *
 * Guard: the `Host` header is checked before the bearer, against the loopback
 * names only. A page that rebinds its own hostname to 127.0.0.1 would otherwise
 * reach this server from the reader's browser.
 */
@Injectable()
export class GatewayServerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayServerService.name);

  private server: Server | undefined;

  private port: number | undefined;

  constructor(
    private readonly grants: GrantRegistry,
    private readonly calls: GatewayCallsService,
    private readonly i18n: I18nService,
  ) {}

  get url(): string {
    if (this.port === undefined) {
      throw new Error("the agent gateway is not listening");
    }

    return `http://${LOOPBACK}:${this.port}${GATEWAY_PATH}`;
  }

  async onModuleInit(): Promise<void> {
    const gate = requireBearerAuth({
      verifier: {
        verifyAccessToken: (token: string): Promise<AuthInfo> => {
          const grant = this.grants.grantFor(token);
          if (grant === undefined) {
            return Promise.reject(
              new OAuthError(OAuthErrorCode.InvalidToken, "unknown grant"),
            );
          }

          return Promise.resolve({
            token,
            clientId: "codex",
            scopes: [],
            expiresAt: Math.floor(grant.expiresAt / 1000),
          });
        },
      },
    });
    const handler = createMcpHandler((context) =>
      this.serverFor(
        context.authInfo === undefined
          ? undefined
          : this.grants.turnFor(context.authInfo.token),
      ),
    );
    const hostnames = localhostAllowedHostnames();
    const node = toNodeHandler({
      fetch: async (request: Request) => {
        const rejected = hostHeaderValidationResponse(request, hostnames);
        if (rejected !== undefined) {
          return rejected;
        }
        if (new URL(request.url).pathname !== GATEWAY_PATH) {
          return new Response(null, { status: 404 });
        }
        const auth = await gate(request);
        if (auth instanceof Response) {
          return auth;
        }

        return handler.fetch(request, { authInfo: auth });
      },
    });

    const server = createServer((req, res) => {
      void node(req, res);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, LOOPBACK, resolve);
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    this.logger.log(`agent gateway listening on ${LOOPBACK}:${this.port}`);
  }

  async onModuleDestroy(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  }

  private serverFor(turn: GatewayTurn | undefined): McpServer {
    const locale = turn?.locale ?? "en";
    const server = new McpServer({ name: GATEWAY_SERVER, version: "1.0.0" });
    const closed = () => ({
      content: [
        {
          type: "text" as const,
          text: this.i18n.t("chat:gateway.no_turn", {}, locale),
        },
      ],
      isError: true,
    });

    server.registerTool(
      "find_tools",
      {
        description: this.i18n.t("chat:gateway.find", {}, locale),
        inputSchema: findToolsInputSchema,
      },
      ({ query }) =>
        turn === undefined ? closed() : this.calls.find(turn, query),
    );
    server.registerTool(
      "call_tool",
      {
        description: this.i18n.t("chat:gateway.call", {}, locale),
        inputSchema: callToolInputSchema,
      },
      (input, context) =>
        turn === undefined
          ? closed()
          : this.calls.call(turn, input, context.mcpReq._meta),
    );

    return server;
  }
}
