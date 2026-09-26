import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  guard as coreGuard,
  type ErrorContext,
  type GuardedHandler,
} from "@liaiso/file-core";

import { asXmlError, fail } from "../host/platform/errors.js";
import type { Definitions, ToolInput, ToolName } from "./definitions.js";

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
