import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
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

export function createFileSourceServer<D extends ToolDefinitions>(
  identity: ServerIdentity,
  definitions: D,
  handlers: HandlersOf<D>,
): McpServer {
  const server = new McpServer(identity);
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
