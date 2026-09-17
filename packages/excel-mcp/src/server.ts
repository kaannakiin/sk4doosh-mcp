import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFileSourceServer } from "@sk-mcp/file-core";
import type { WorkbookRoot } from "./paths.js";
import { createHandlers, toolDefinitions } from "./tools.js";
import { closeRegexWorkers } from "./regex.js";

/**
 * Guard: the specifier is relative to the package root. This file stays at the
 * src/ root, so one `..` from dist/server.js reaches package.json; a folder
 * below src/ needs another `..`, and getting it wrong throws MODULE_NOT_FOUND
 * at server construction rather than at build time.
 */
const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export function createExcelMcpServer(root: WorkbookRoot): McpServer {
  const server = createFileSourceServer(
    { name: "sk-mcp-excel", version: manifest.version },
    toolDefinitions,
    createHandlers(root),
  );
  const close = server.close.bind(server);
  server.close = async () => {
    await closeRegexWorkers();
    await close();
  };
  return server;
}
