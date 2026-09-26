import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpOutputServer } from "@liaiso/mcp-core";
import type { QueuedBackend } from "./backend/port.js";
import type { Workspace } from "./platform/workspace.js";
import { toolDefinitions } from "./tools/definitions.js";
import { createHandlers } from "./tools/handlers.js";

const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export function createLlmMcpServer(
  backend: QueuedBackend,
  workspace: Workspace,
): McpServer {
  return createMcpOutputServer(
    { name: "liaiso-llm", version: manifest.version },
    toolDefinitions,
    createHandlers(backend, workspace),
  );
}
