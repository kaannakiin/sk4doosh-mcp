import {
  json,
  type StubCall,
  type StubHandler,
  type StubReply,
} from "./oauth-stub.ts";

export interface StubTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly annotations?: Record<string, unknown>;
}

export interface McpStubOptions {
  /** Serves every frame without looking at the bearer, the way a public server does. */
  readonly open?: boolean;
  readonly tools?: readonly StubTool[];
  readonly expiresIn?: number;
  readonly rotateRefresh?: boolean;
  readonly revocation?: boolean;
  readonly eventStream?: boolean;
  readonly refreshRejected?: boolean;
  readonly pageSize?: number;
  /** Answers every `tools/call` with `isError`, the way a tool that refused would. */
  readonly callIsError?: boolean;
  /** Pads the call result so it overruns the caller's byte ceiling. */
  readonly callBodyBytes?: number;
  /** Answers `404` once to a request that presents a session id, then behaves. */
  readonly sessionExpires?: boolean;
}

export interface StubState {
  accessToken: string;
  refreshToken: string;
  readonly grants: { grantType: string; resource: string | undefined }[];
  readonly revocations: { token: string; hint: string | undefined }[];
  readonly toolListings: { cursor: string | undefined }[];
  readonly calls: { name: string; args: unknown }[];
  readonly handshakes: { sessionId: string | undefined }[];
  registrations: number;
}

export interface McpStub {
  readonly handler: StubHandler;
  readonly state: StubState;
}

const SESSION_ID = "stub-session";

function frame(id: unknown, result: unknown, asEvent: boolean): StubReply {
  const payload = JSON.stringify({ jsonrpc: "2.0", id, result });

  return asEvent
    ? {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "mcp-session-id": SESSION_ID,
        },
        body: `event: message\ndata: ${payload}\n\n`,
      }
    : {
        status: 200,
        headers: {
          "content-type": "application/json",
          "mcp-session-id": SESSION_ID,
        },
        body: payload,
      };
}

function formOf(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

function bearerOf(call: StubCall): string | undefined {
  const header = call.headers["authorization"];

  return header?.startsWith("Bearer ") === true
    ? header.slice("Bearer ".length)
    : undefined;
}

/**
 * A complete counterpart for the connect flow: a protected MCP endpoint, the
 * authorization server that guards it, and the token lifecycle between them.
 *
 * Every test that needs more than one of those needs all of them — discovery
 * reads the resource metadata the endpoint's `401` names, and a refresh has to
 * be answered by the same server that minted what it replaces.
 */
export function mcpStub(options: McpStubOptions = {}): McpStub {
  const tools = options.tools ?? [];
  const pageSize = options.pageSize ?? tools.length;
  const state: StubState = {
    accessToken: "",
    refreshToken: "",
    grants: [],
    revocations: [],
    toolListings: [],
    calls: [],
    handshakes: [],
    registrations: 0,
  };
  let issued = 0;
  let expired = false;

  const issue = (
    grantType: string,
    resource: string | undefined,
  ): StubReply => {
    issued += 1;
    state.grants.push({ grantType, resource });
    state.accessToken = `at-${issued}`;
    if (state.refreshToken === "" || options.rotateRefresh === true) {
      state.refreshToken = `rt-${issued}`;
    }

    return json({
      access_token: state.accessToken,
      refresh_token: state.refreshToken,
      token_type: "Bearer",
      expires_in: options.expiresIn ?? 3600,
      scope: "orders.read",
    });
  };

  const rpc = (call: StubCall, origin: string): StubReply => {
    if (
      options.open !== true &&
      (bearerOf(call) !== state.accessToken || state.accessToken === "")
    ) {
      return {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        },
      };
    }

    const request = JSON.parse(call.body) as {
      id?: unknown;
      method: string;
      params?: { cursor?: string; name?: string; arguments?: unknown };
    };

    const presented = call.headers["mcp-session-id"];
    if (
      options.sessionExpires === true &&
      presented !== undefined &&
      request.id !== undefined &&
      !expired
    ) {
      expired = true;

      return { status: 404 };
    }

    if (request.method === "initialize") {
      state.handshakes.push({ sessionId: presented });

      return frame(
        request.id,
        {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "stub", version: "0" },
        },
        options.eventStream === true,
      );
    }

    if (request.method === "notifications/initialized") {
      return { status: 202 };
    }

    if (request.method === "tools/list") {
      const cursor = request.params?.cursor;
      state.toolListings.push({ cursor });
      const from = cursor === undefined ? 0 : Number(cursor);
      const page = tools.slice(from, from + Math.max(pageSize, 1));
      const next = from + page.length;

      return frame(
        request.id,
        {
          tools: page.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema ?? { type: "object" },
            ...(tool.annotations === undefined
              ? {}
              : { annotations: tool.annotations }),
          })),
          ...(next < tools.length ? { nextCursor: String(next) } : {}),
        },
        options.eventStream === true,
      );
    }

    if (request.method === "tools/call") {
      state.calls.push({
        name: request.params?.name ?? "",
        args: request.params?.arguments,
      });

      const padding =
        options.callBodyBytes === undefined
          ? ""
          : "x".repeat(options.callBodyBytes);

      return frame(
        request.id,
        {
          content: [
            { type: "text", text: `ran ${request.params?.name}${padding}` },
          ],
          ...(options.callIsError === true ? { isError: true } : {}),
        },
        options.eventStream === true,
      );
    }

    return frame(request.id, {}, options.eventStream === true);
  };

  const handler: StubHandler = (call, origin) => {
    const [path] = call.path.split("?");

    if (path === "/mcp") {
      return rpc(call, origin);
    }

    if (path === "/.well-known/oauth-protected-resource/mcp") {
      return json({
        resource: `${origin}/mcp`,
        authorization_servers: [`${origin}/`],
        scopes_supported: ["orders.read"],
      });
    }

    if (path === "/.well-known/oauth-authorization-server") {
      return json({
        issuer: `${origin}/`,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        code_challenge_methods_supported: ["S256"],
        ...(options.revocation === true
          ? { revocation_endpoint: `${origin}/revoke` }
          : {}),
      });
    }

    if (path === "/register") {
      state.registrations += 1;

      return json(
        {
          client_id: "cid-stub",
          client_secret: "stub-secret",
          client_secret_expires_at: 0,
          token_endpoint_auth_method: "client_secret_basic",
        },
        201,
      );
    }

    if (path === "/token") {
      const form = formOf(call.body);
      const grantType = form.get("grant_type") ?? "";

      if (grantType === "refresh_token" && options.refreshRejected === true) {
        return json({ error: "invalid_grant" }, 400);
      }

      return issue(grantType, form.get("resource") ?? undefined);
    }

    if (path === "/revoke") {
      const form = formOf(call.body);
      state.revocations.push({
        token: form.get("token") ?? "",
        hint: form.get("token_type_hint") ?? undefined,
      });

      return { status: 200 };
    }

    return { status: 404 };
  };

  return { handler, state };
}
