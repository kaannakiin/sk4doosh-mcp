import type { EndpointPolicy } from "@chat/contracts/integration/discovery";
import {
  remoteToolSchema,
  type RemoteTool,
} from "@chat/contracts/integration/remote-tool";

import { guardedFollow, type GuardedOutcome } from "./guarded-http.ts";

const PROTOCOL_VERSION = "2025-06-18";

/**
 * Guard: a page ceiling rather than a loop until the cursor runs out. The cursor
 * is a value the remote server invents, and a server that always returns one
 * holds this request open for as long as it cares to.
 */
const MAX_PAGES = 10;

export type McpFailure =
  | "unauthorized"
  | "blocked_address"
  | "unreachable"
  | "malformed"
  | "rejected";

export type McpOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "failed"; readonly failure: McpFailure };

export interface McpTarget {
  readonly url: string;
  readonly accessToken: string | undefined;
  readonly endpoint: EndpointPolicy;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

interface Frame {
  readonly result?: unknown;
  readonly error?: { readonly message?: unknown };
}

/**
 * Guard: the frame is read out of the `data:` lines when the server answered
 * with an event stream. MCP's streamable http transport lets a server reply to
 * a plain request either way, and parsing the raw body as json would report a
 * conforming server as malformed.
 */
function frameFrom(headers: Record<string, string>, body: string): unknown {
  const contentType = headers["content-type"] ?? "";
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(body);
  }

  for (const line of body.split("\n")) {
    if (line.startsWith("data:")) {
      return JSON.parse(line.slice("data:".length).trim());
    }
  }

  throw new SyntaxError("the event stream carried no data line");
}

function failureOf(outcome: GuardedOutcome): McpFailure {
  return outcome.kind === "refused" ? "blocked_address" : "unreachable";
}

/**
 * One MCP session: `initialize`, then whatever the caller asks for.
 *
 * Guard: redirects are never followed. Every request here carries the user's
 * bearer token, which puts it in the same class as the token and registration
 * requests — a `302` would replay that token to whatever host the response
 * named.
 */
class McpSession {
  private sessionId: string | undefined;

  private nextId = 1;

  constructor(private readonly target: McpTarget) {}

  async call(method: string, params: unknown): Promise<McpOutcome<unknown>> {
    const id = this.nextId;
    this.nextId += 1;

    const outcome = await guardedFollow(
      {
        url: this.target.url,
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        timeoutMs: this.target.timeoutMs,
        maxBytes: this.target.maxBytes,
        maxRedirects: 0,
      },
      this.target.endpoint,
    );

    if (outcome.kind !== "response") {
      return { kind: "failed", failure: failureOf(outcome) };
    }

    const { response } = outcome;
    if (response.status === 401 || response.status === 403) {
      return { kind: "failed", failure: "unauthorized" };
    }

    if (response.status >= 400) {
      return { kind: "failed", failure: "rejected" };
    }

    const issued = response.headers["mcp-session-id"];
    if (issued !== undefined) {
      this.sessionId = issued;
    }

    let frame: Frame;
    try {
      frame = frameFrom(response.headers, response.body) as Frame;
    } catch {
      return { kind: "failed", failure: "malformed" };
    }

    if (frame.error !== undefined) {
      return { kind: "failed", failure: "rejected" };
    }

    return { kind: "ok", value: frame.result };
  }

  /**
   * Guard: a notification carries no id and the server answers `202` with no
   * body, so it is sent apart from `call` rather than through it. Reading a
   * frame out of an empty body would report a conforming server as malformed.
   */
  async notify(method: string): Promise<void> {
    await guardedFollow(
      {
        url: this.target.url,
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", method }),
        timeoutMs: this.target.timeoutMs,
        maxBytes: this.target.maxBytes,
        maxRedirects: 0,
      },
      this.target.endpoint,
    );
  }

  /**
   * Guard: the header is omitted rather than sent empty when there is no token.
   * A server that needs none still parses what it is given, and
   * `Bearer undefined` is a credential it has every reason to refuse.
   */
  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      ...(this.target.accessToken === undefined
        ? {}
        : { authorization: `Bearer ${this.target.accessToken}` }),
      ...(this.sessionId === undefined
        ? {}
        : { "mcp-session-id": this.sessionId }),
    };
  }
}

/**
 * Lists the tools a remote MCP server offers this connection.
 *
 * Guard: the handshake is performed in full. A server that follows the spec
 * refuses `tools/list` before `initialize` and the `initialized` notification,
 * and the session id it hands back on the first response is required on every
 * request after it.
 *
 * Guard: a tool that does not parse is dropped, not fatal. The list is written
 * by a server this platform has not met, and discarding the whole response over
 * one malformed entry would make a single bad tool hide every good one.
 *
 * @param target the endpoint, the bearer token, and the transport limits
 * @returns the tools, or why the server could not be read
 */
export type RemoteToolList = readonly RemoteTool[];

export async function listTools(
  target: McpTarget,
): Promise<McpOutcome<RemoteToolList>> {
  const session = new McpSession(target);

  const initialized = await session.call("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "sk4doosh", version: "0" },
  });

  if (initialized.kind === "failed") {
    return initialized;
  }

  await session.notify("notifications/initialized");

  const tools: RemoteTool[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const listed = await session.call(
      "tools/list",
      cursor === undefined ? {} : { cursor },
    );

    if (listed.kind === "failed") {
      return listed;
    }

    const value = listed.value;
    if (typeof value !== "object" || value === null || !("tools" in value)) {
      return { kind: "failed", failure: "malformed" };
    }

    const { tools: listedTools, nextCursor } = value as {
      tools: unknown;
      nextCursor?: unknown;
    };

    if (!Array.isArray(listedTools)) {
      return { kind: "failed", failure: "malformed" };
    }

    for (const raw of listedTools) {
      const parsed = remoteToolSchema.safeParse(raw);
      if (parsed.success) {
        tools.push(parsed.data);
      }
    }

    if (typeof nextCursor !== "string" || nextCursor.length === 0) {
      return { kind: "ok", value: tools };
    }

    cursor = nextCursor;
  }

  return { kind: "failed", failure: "malformed" };
}
