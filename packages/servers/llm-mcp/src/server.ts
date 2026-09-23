import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpSourceServer } from "@sk-mcp/mcp-core";
import type { QueuedBackend } from "./backend/port.js";
import { toolDefinitions } from "./tools/definitions.js";
import { createHandlers } from "./tools/handlers.js";

const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export function createLlmMcpServer(backend: QueuedBackend): McpServer {
  return createMcpSourceServer(
    { name: "sk-mcp-llm", version: manifest.version },
    toolDefinitions,
    createHandlers(backend),
  );
}
