import { guard, json } from "@sk-mcp/mcp-core";
import type { QueuedBackend } from "../backend/port.js";
import { asLlmError, fail } from "../platform/errors.js";
import { inputBudgetTokens } from "../platform/limits.js";
import type { ToolHandlers } from "./definitions.js";

export function createHandlers(backend: QueuedBackend): ToolHandlers {
  return {
    local_status: guard(
      { tool: "local_status", fail },
      async (_args, _tool, signal) => {
        const probe = await backend.probe(signal);
        return json({
          model: backend.model,
          ...probe,
          contextTokens: backend.contextTokens,
          inputBudgetTokens: inputBudgetTokens(backend.contextTokens),
          queued: backend.pending,
        });
      },
      asLlmError,
    ),
  };
}
