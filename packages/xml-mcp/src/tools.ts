import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  guard as coreGuard,
  json,
  readOnly,
  toolNamesOf,
  type ErrorContext,
  type GuardedHandler,
  type HandlersOf,
  type ToolDefinitions,
  type ToolInputOf,
  type ToolNameOf,
} from "@sk-mcp/file-core";
import { z } from "zod";
import { asXmlError, fail } from "./errors.js";
import { limits } from "./limits.js";
import { listDocuments, type DocumentRoot } from "./paths.js";

export const toolDefinitions = {
  list_documents: {
    description:
      "List readable XML documents under the server root. Returns filePath values that other tools accept verbatim. The listing never parses a file, so a listed path is a candidate, not a guarantee of well-formed XML. totalExact distinguishes a complete total; scanTruncated is separate from the result page limit.",
    inputSchema: z.object({
      subdirectory: z
        .string()
        .optional()
        .describe("Folder under the root to list."),
      pattern: z
        .string()
        .optional()
        .describe("Glob over the relative path, for example build/*.csproj."),
      maxResults: z
        .int()
        .min(1)
        .max(limits.maxListResults)
        .optional()
        .describe(
          "Maximum returned files, default 50. Does not increase the traversal budget.",
        ),
    }),
    annotations: readOnly,
  },
} as const satisfies ToolDefinitions;

type Definitions = typeof toolDefinitions;

export type ToolName = ToolNameOf<Definitions>;

export const toolNames: readonly ToolName[] = toolNamesOf(toolDefinitions);

type ToolInput<K extends ToolName> = ToolInputOf<Definitions, K>;

export type ToolHandlers = HandlersOf<Definitions>;

export function guard<K extends ToolName>(
  context: ErrorContext & { readonly tool: K },
  handler: (
    args: ToolInput<K>,
    tool: K,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>,
): GuardedHandler<Definitions, K> {
  return coreGuard<Definitions, K>({ ...context, fail }, handler, asXmlError);
}

export function createHandlers(root: DocumentRoot): ToolHandlers {
  return {
    list_documents: guard(
      { root: root.real, tool: "list_documents" },
      async (args) => {
        const listing = await listDocuments(root, {
          ...(args.subdirectory === undefined
            ? {}
            : { subdirectory: args.subdirectory }),
          ...(args.pattern === undefined ? {} : { pattern: args.pattern }),
          maxResults: args.maxResults ?? limits.defaultListResults,
        });
        return json({ root: root.real, ...listing });
      },
    ),
  };
}
