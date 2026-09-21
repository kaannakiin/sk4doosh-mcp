import { McpServer } from "@modelcontextprotocol/server";
import type { ToolCallback } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { coreLimits } from "./limits.js";
import type { HandlersOf, ToolDefinitions, ToolNameOf } from "./tools.js";

type NoOutputSchema = never;

type SdkInputSchema = ToolDefinitions[string]["inputSchema"];

export interface ServerIdentity {
  readonly name: string;
  readonly version: string;
}

export function toolNamesOf<D extends ToolDefinitions>(
  definitions: D,
): readonly ToolNameOf<D>[] {
  return Object.keys(definitions) as ToolNameOf<D>[];
}

/**
 * Guard: a file server's catalogue is fixed at build time and identical for every caller, so both
 * cacheable list results are `public`. Without a hint the SDK emits the conservative
 * `ttlMs: 0, cacheScope: "private"` on the 2026-07-28 revision, which makes every agent turn re-read
 * a tool list that cannot have changed. 2025-era responses never carry these fields.
 */
const catalogCacheHints = {
  "tools/list": { ttlMs: coreLimits.catalogTtlMs, cacheScope: "public" },
  "server/discover": { ttlMs: coreLimits.catalogTtlMs, cacheScope: "public" },
} as const;

export function createFileSourceServer<D extends ToolDefinitions>(
  identity: ServerIdentity,
  definitions: D,
  handlers: HandlersOf<D>,
): McpServer {
  const server = new McpServer(identity, { cacheHints: catalogCacheHints });
  for (const name of toolNamesOf(definitions)) {
    const definition = definitions[name] as ToolDefinitions[string];
    server.registerTool<NoOutputSchema, SdkInputSchema>(
      name,
      definition,
      handlers[name] as unknown as ToolCallback<SdkInputSchema>,
    );
  }
  return server;
}

/**
 * Serves one file-backed server over stdio, on both the 2025 era and 2026-07-28.
 *
 * Guard: `onerror` writes to stderr because stdout is the protocol channel — a stray line there
 * corrupts the JSON-RPC stream and the client loses the session with no error to show. The signal
 * handlers exist so the pinned instance's `close()` runs on a terminated process: the format
 * packages hang their worker drain off it, and a skipped drain leaves the workers holding the event
 * loop open.
 */
export function serveFileSourceStdio(
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
