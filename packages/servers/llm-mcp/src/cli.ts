#!/usr/bin/env node
import { serveMcpSourceStdio } from "@sk-mcp/mcp-core";
import { createOllamaBackend } from "./backend/ollama.js";
import { createSerialBackend } from "./backend/serial.js";
import { readLlmEnv, requiredNames } from "./platform/env.js";
import { fail } from "./platform/errors.js";
import { openWorkspace, type Workspace } from "./platform/workspace.js";
import { createLlmMcpServer } from "./server.js";

function stop(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/**
 * Guard: every variable is named explicitly instead of handing the whole
 * environment to the parser. `turbo/no-undeclared-env-vars` only sees a named
 * access, and that is what forces each one into this package's `passThroughEnv`.
 */
const outcome = readLlmEnv(
  {
    SKMCP_LLM_ROOT: process.env["SKMCP_LLM_ROOT"],
    SKMCP_LLM_OUTPUT_DIR: process.env["SKMCP_LLM_OUTPUT_DIR"],
    SKMCP_LLM_BASE_URL: process.env["SKMCP_LLM_BASE_URL"],
    SKMCP_LLM_MODEL: process.env["SKMCP_LLM_MODEL"],
    SKMCP_LLM_NUM_CTX: process.env["SKMCP_LLM_NUM_CTX"],
    SKMCP_LLM_KEEP_ALIVE: process.env["SKMCP_LLM_KEEP_ALIVE"],
    SKMCP_LLM_TIMEOUT_MS: process.env["SKMCP_LLM_TIMEOUT_MS"],
  },
  process.cwd(),
);

if (outcome.kind === "usage") {
  stop(
    `sk-mcp-llm reads its model host from the environment. Missing: ${outcome.missing.join(", ")}.\nRequired: ${requiredNames.join(", ")}.`,
    2,
  );
}

if (outcome.kind === "invalid") {
  stop(outcome.reason, 2);
}

let workspace: Workspace;
try {
  workspace = await openWorkspace(
    outcome.config.root,
    fail,
    outcome.config.outputDir,
  );
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  stop(`sk-mcp-llm cannot open its workspace: ${detail}`, 2);
}

const backend = createSerialBackend(createOllamaBackend(outcome.config));
const server = createLlmMcpServer(backend, workspace);
serveMcpSourceStdio(() => server);

/**
 * Guard: parsing is fatal, reaching the host is not. The server answers
 * `tools/list` and `local_status` with the host down, so warming is started
 * after serving and its failure is only reported.
 */
backend.warm().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sk-mcp-llm: warm-up failed: ${detail}\n`);
});
