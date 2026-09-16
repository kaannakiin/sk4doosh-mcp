import { findToolsInputSchema } from "./find-tools.ts";

/**
 * The one tool this product adds to reach a reader's connected MCP servers.
 *
 * It is declared here, beside the reader catalogs, because it is this platform's
 * own tool and not a discovered one: its name belongs in the closed
 * `ChatToolName` vocabulary, and its approval posture is decided by name like
 * every other tool this product ships.
 */
export const DISCOVERY_TOOL_SCHEMAS = {
  find_tools: { inputSchema: findToolsInputSchema },
} as const;

export type DiscoveryToolSchemas = typeof DISCOVERY_TOOL_SCHEMAS;
