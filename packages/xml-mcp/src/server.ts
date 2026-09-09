import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFileSourceServer } from "@sk-mcp/file-core";
import { createXmlDocumentCache } from "./document.js";
import { SkMcpXmlError } from "./errors.js";
import { limits, workerCapacityFor } from "./limits.js";
import type { DocumentRoot } from "./paths.js";
import { createHandlers, toolDefinitions } from "./tools.js";
import { createXmlWorkerPool, type XmlWorkerPool } from "./worker-pool.js";

const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

const maxDocumentCacheSize = 64;

export interface XmlMcpServerOptions {
  /**
   * A budget, not a guard: K5 measured that worker.resourceLimits bounds the JS
   * heap and not WASM linear memory, so overshooting is process death rather
   * than a clean resource_limit. The per-document cost is in the F2 closure
   * record; the default is the value that is safe on the smallest host.
   */
  readonly documentCacheSize?: number;
  readonly maxConcurrentListings?: number;
}

function requireCacheSize(value: number | undefined): number {
  if (value === undefined) return limits.documentCacheSize;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maxDocumentCacheSize
  ) {
    throw new SkMcpXmlError(
      "invalid_argument",
      `documentCacheSize must be an integer between 1 and ${String(maxDocumentCacheSize)}.`,
    );
  }
  return value;
}

export function createXmlMcpServer(
  root: DocumentRoot,
  options: XmlMcpServerOptions = {},
): McpServer {
  const documentCacheSize = requireCacheSize(options.documentCacheSize);
  const pool: XmlWorkerPool = createXmlWorkerPool({
    capacity: workerCapacityFor(documentCacheSize),
  });
  const cache = createXmlDocumentCache(pool, root.real, documentCacheSize);
  const server = createFileSourceServer(
    { name: "sk-mcp-xml", version: manifest.version },
    toolDefinitions,
    createHandlers(root, {
      pool,
      cache,
      ...(options.maxConcurrentListings === undefined
        ? {}
        : { maxConcurrentListings: options.maxConcurrentListings }),
    }),
  );
  const close = server.close.bind(server);
  server.close = async () => {
    await pool.close();
    cache.clear();
    await close();
  };
  return server;
}
