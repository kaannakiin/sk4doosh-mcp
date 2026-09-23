import { describe, expect, it } from "vitest";

import {
  LOCAL_WORKER_SERVER,
  codexConfigFor,
} from "../src/codex/codex-config.ts";

const llm = { baseUrl: "http://10.0.0.5:11434", model: "qwen3:8b" };

describe("codexConfigFor", () => {
  it("keeps the sandbox offline and binds no MCP server without a worker", () => {
    expect(codexConfigFor({}, llm)).toEqual({
      sandbox_workspace_write: { network_access: false },
    });
  });

  it("starts the local worker with node, the host and the model", () => {
    const config = codexConfigFor(
      { localWorker: "/srv/llm-mcp/dist/cli.js" },
      llm,
    );
    expect(config).toEqual({
      sandbox_workspace_write: { network_access: false },
      mcp_servers: {
        [LOCAL_WORKER_SERVER]: {
          command: process.execPath,
          args: ["/srv/llm-mcp/dist/cli.js"],
          default_tools_approval_mode: "auto",
          tool_timeout_sec: 900,
          env: {
            SKMCP_LLM_BASE_URL: "http://10.0.0.5:11434",
            SKMCP_LLM_MODEL: "qwen3:8b",
          },
        },
      },
    });
  });
});
