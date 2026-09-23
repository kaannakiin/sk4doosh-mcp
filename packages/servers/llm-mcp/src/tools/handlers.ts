import { guard, json } from "@sk-mcp/mcp-core";
import type { QueuedBackend } from "../backend/port.js";
import { asLlmError, fail } from "../platform/errors.js";
import { inputBudgetTokens } from "../platform/limits.js";
import type { Workspace } from "../platform/workspace.js";
import type { ToolHandlers } from "./definitions.js";
import { runMap } from "./map.js";
import { runTask } from "./task.js";

export function createHandlers(
  backend: QueuedBackend,
  workspace: Workspace,
): ToolHandlers {
  const context = { fail, redact: workspace.redact };
  return {
    local_status: guard(
      { ...context, tool: "local_status" },
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
    local_task: guard(
      { ...context, tool: "local_task" },
      async (args, _tool, signal) =>
        json(await runTask({ backend, workspace }, args, signal)),
      asLlmError,
    ),
    local_map: guard(
      { ...context, tool: "local_map" },
      async (args, _tool, signal) =>
        json(await runMap({ backend, workspace }, args, signal)),
      asLlmError,
    ),
  };
}
