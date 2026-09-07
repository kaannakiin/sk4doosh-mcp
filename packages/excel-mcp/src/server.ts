import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFileSourceServer } from "@sk-mcp/file-core";
import type { WorkbookRoot } from "./paths.js";
import { createHandlers, toolDefinitions } from "./tools.js";

const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export function createExcelMcpServer(root: WorkbookRoot): McpServer {
  return createFileSourceServer(
    { name: "sk-mcp-excel", version: manifest.version },
    toolDefinitions,
    createHandlers(root),
  );
}
