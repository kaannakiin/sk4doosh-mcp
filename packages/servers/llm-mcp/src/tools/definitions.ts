import {
  readOnly,
  toolNamesOf,
  type HandlersOf,
  type ToolDefinitions,
  type ToolInputOf,
  type ToolNameOf,
} from "@sk-mcp/mcp-core";
import { z } from "zod";

export const toolDefinitions = {
  local_status: {
    description:
      "Report whether the free local model is reachable and loaded, its context window, the input budget one call may use, and how many local calls are waiting. Call it when you are unsure the local model is available before delegating to it.",
    inputSchema: z.object({}),
    annotations: readOnly,
  },
} as const satisfies ToolDefinitions;

export type Definitions = typeof toolDefinitions;
export type ToolName = ToolNameOf<Definitions>;
export const toolNames: readonly ToolName[] = toolNamesOf(toolDefinitions);
export type ToolInput<K extends ToolName> = ToolInputOf<Definitions, K>;
export type ToolHandlers = HandlersOf<Definitions>;
