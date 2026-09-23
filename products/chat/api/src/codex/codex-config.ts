import type { CodexOptions } from "@openai/codex-sdk";

import type { CodexConfig, LlmConfig } from "../config/configuration.ts";

type CodexConfigObject = NonNullable<CodexOptions["config"]>;

export const LOCAL_WORKER_SERVER = "local";

const LOCAL_WORKER_TIMEOUT_SEC = 900;

/**
 * Builds the `--config` overrides every agent turn runs with.
 *
 * Guard: the local worker's host and model travel in `mcp_servers.<name>.env`
 * because codex hands an MCP server none of its own environment — only `HOME`
 * and `PATH` were measured arriving (docs/llm-mcp-plani.md, rule 2). The
 * approval mode is `auto` because under `approvalPolicy: "never"` a tool call
 * that asks for approval is rejected outright (rule 1); `auto` decides from the
 * tool's own annotations. The timeout covers time spent queued behind other
 * local calls (rule 6). `num_ctx` is left to the server's default on purpose:
 * `CHAT_LLM_CONTEXT_TOKENS` is what the orchestrator requests, not the window
 * the GPU was measured to deliver.
 */
export function codexConfigFor(
  codex: Pick<CodexConfig, "localWorker">,
  llm: Pick<LlmConfig, "baseUrl" | "model">,
): CodexConfigObject {
  return {
    sandbox_workspace_write: { network_access: false },
    ...(codex.localWorker === undefined
      ? {}
      : {
          mcp_servers: {
            [LOCAL_WORKER_SERVER]: {
              command: process.execPath,
              args: [codex.localWorker],
              default_tools_approval_mode: "auto",
              tool_timeout_sec: LOCAL_WORKER_TIMEOUT_SEC,
              env: {
                SKMCP_LLM_BASE_URL: llm.baseUrl,
                SKMCP_LLM_MODEL: llm.model,
              },
            },
          },
        }),
  };
}
