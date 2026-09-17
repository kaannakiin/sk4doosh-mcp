import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  guard as coreGuard,
  type ErrorContext,
  type GuardedHandler,
} from "@sk-mcp/file-core";
import { asExcelError, fail } from "./platform/errors.js";
import type { Definitions, ToolInput, ToolName } from "./tools-definitions.js";

export function guard<K extends ToolName>(
  context: ErrorContext & { readonly tool: K },
  handler: (
    args: ToolInput<K>,
    tool: K,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>,
): GuardedHandler<Definitions, K> {
  return coreGuard<Definitions, K>({ ...context, fail }, handler, asExcelError);
}
