import { McpServer } from "@modelcontextprotocol/server";
import type { ToolCallback } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { mcpCoreLimits } from "./limits.js";
import type {
  HandlersOf,
  ToolCatalog,
  ToolDefinitions,
  ToolNameOf,
} from "./tools.js";

type NoOutputSchema = never;

type SdkInputSchema = ToolCatalog[string]["inputSchema"];

export interface ServerIdentity {
  readonly name: string;
  readonly version: string;
}

export function toolNamesOf<D extends ToolCatalog>(
  definitions: D,
): readonly ToolNameOf<D>[] {
  return Object.keys(definitions) as ToolNameOf<D>[];
}

/**
 * Guard: a source server's catalogue is fixed at build time and identical for every caller, so
 * both cacheable list results are `public`. Without a hint the SDK emits the conservative
 * `ttlMs: 0, cacheScope: "private"` on the 2026-07-28 revision, which makes every agent turn re-read
 * a tool list that cannot have changed. 2025-era responses never carry these fields.
 */
const catalogCacheHints = {
  "tools/list": { ttlMs: mcpCoreLimits.catalogTtlMs, cacheScope: "public" },
  "server/discover": {
    ttlMs: mcpCoreLimits.catalogTtlMs,
    cacheScope: "public",
  },
} as const;

function buildServer<D extends ToolCatalog>(
  identity: ServerIdentity,
  definitions: D,
  handlers: HandlersOf<D>,
): McpServer {
  const server = new McpServer(identity, { cacheHints: catalogCacheHints });
  for (const name of toolNamesOf(definitions)) {
    const definition = definitions[name] as ToolCatalog[string];
    server.registerTool<NoOutputSchema, SdkInputSchema>(
      name,
      definition,
      handlers[name] as unknown as ToolCallback<SdkInputSchema>,
    );
  }
  return server;
}

export function createMcpSourceServer<D extends ToolDefinitions>(
  identity: ServerIdentity,
  definitions: D,
  handlers: HandlersOf<D>,
): McpServer {
  return buildServer(identity, definitions, handlers);
}

/**
 * Registers a catalogue that may mix read-only tools with tools that add to the server's own
 * output.
 *
 * Guard: this is the only way such a tool reaches a server. `createMcpSourceServer` keeps its
 * read-only constraint and `file-core` and `db-core` do not re-export this function, so a server
 * built on either of them cannot register a writing tool.
 */
export function createMcpOutputServer<D extends ToolCatalog>(
  identity: ServerIdentity,
  definitions: D,
  handlers: HandlersOf<D>,
): McpServer {
  return buildServer(identity, definitions, handlers);
}

/**
 * Serves one source server over stdio, on both the 2025 era and 2026-07-28.
 *
 * Guard: `onerror` writes to stderr because stdout is the protocol channel — a stray line there
 * corrupts the JSON-RPC stream and the client loses the session with no error to show. The signal
 * handlers exist so the pinned instance's `close()` runs on a terminated process: a source that
 * hangs a worker drain or a connection pool off it leaves them holding the event loop open
 * otherwise.
 */
export function serveMcpSourceStdio(
  factory: () => McpServer,
): StdioServerHandle {
  const handle = serveStdio(factory, {
    onerror: (error) => {
      process.stderr.write(`${error.message}\n`);
    },
  });
  const shutdown = (): void => {
    void handle.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return handle;
}
