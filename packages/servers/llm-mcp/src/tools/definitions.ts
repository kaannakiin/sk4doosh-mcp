import {
  readOnly,
  toolNamesOf,
  type HandlersOf,
  type ToolDefinitions,
  type ToolInputOf,
  type ToolNameOf,
} from "@sk-mcp/mcp-core";
import { z } from "zod";
import { taskKinds } from "./prompts.js";

export const maxTaskFiles = 8;

export const toolDefinitions = {
  local_status: {
    description:
      "Report whether the free local model is reachable and loaded, its context window, the input budget one call may use, and how many local calls are waiting. Call it when you are unsure the local model is available before delegating to it.",
    inputSchema: z.object({}),
    annotations: readOnly,
  },
  local_task: {
    description:
      "Run one bounded language task on the free local model: classify, extract, summarize, transform, or free. Pass file paths in `files` instead of pasting their contents; the server reads them itself, so their text never enters your context. With `jsonSchema` the answer is JSON matching that schema, returned as `result`; otherwise it is text, returned as `answer`. The local window is small: an input over its budget is refused as input_too_large, never truncated.",
    inputSchema: z.object({
      kind: z.enum(taskKinds),
      instruction: z
        .string()
        .min(1)
        .describe("What to do with the input, stated precisely."),
      text: z.string().optional().describe("Short input given inline."),
      files: z
        .array(z.string().min(1))
        .max(maxTaskFiles)
        .optional()
        .describe("Paths relative to the working directory."),
      jsonSchema: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("A JSON Schema the answer must match."),
    }),
    annotations: readOnly,
  },
} as const satisfies ToolDefinitions;

export type Definitions = typeof toolDefinitions;
export type ToolName = ToolNameOf<Definitions>;
export const toolNames: readonly ToolName[] = toolNamesOf(toolDefinitions);
export type ToolInput<K extends ToolName> = ToolInputOf<Definitions, K>;
export type ToolHandlers = HandlersOf<Definitions>;
