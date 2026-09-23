import {
  ownOutput,
  readOnly,
  toolNamesOf,
  type HandlersOf,
  type ToolCatalog,
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
  local_map: {
    description:
      "Label every row of a CSV file with one of the given labels on the free local model, for row-wise judgement that needs language understanding. You never see the rows: pass the path, and the server writes a labelled copy (the original columns plus one label column) as a new file in its output directory and returns that file's path, the counts per label, and up to four sample rows per label. Check the samples before using the output. Rows a simple rule or keyword can decide are faster with a script.",
    inputSchema: z.object({
      file: z
        .string()
        .min(1)
        .describe("CSV path relative to the working directory."),
      instruction: z
        .string()
        .min(1)
        .describe(
          "How to decide one row's label, naming the cues you saw in a sample.",
        ),
      labels: z.array(z.string().min(1).max(64)).min(2).max(50),
      labelColumn: z
        .string()
        .min(1)
        .max(64)
        .optional()
        .describe("Name of the added column; defaults to label."),
    }),
    annotations: ownOutput,
  },
} as const satisfies ToolCatalog;

export type Definitions = typeof toolDefinitions;
export type ToolName = ToolNameOf<Definitions>;
export const toolNames: readonly ToolName[] = toolNamesOf(toolDefinitions);
export type ToolInput<K extends ToolName> = ToolInputOf<Definitions, K>;
export type ToolHandlers = HandlersOf<Definitions>;
