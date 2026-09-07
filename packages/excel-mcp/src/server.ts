import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbookRoot } from "./paths.js";
import {
  createHandlers,
  toolDefinitions,
  toolNames,
  type ToolInputSchema,
} from "./tools.js";

const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

type NoOutputSchema = never;

export function createExcelMcpServer(root: WorkbookRoot): McpServer {
  const server = new McpServer({
    name: "sk-mcp-excel",
    version: manifest.version,
  });
  const handlers = createHandlers(root);

  for (const name of toolNames) {
    server.registerTool<NoOutputSchema, ToolInputSchema>(
      name,
      toolDefinitions[name],
      handlers[name],
    );
  }

  return server;
}
