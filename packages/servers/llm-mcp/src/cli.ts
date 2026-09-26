#!/usr/bin/env node
import { serveMcpSourceStdio } from "@liaiso/mcp-core";
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
    LIAISO_LLM_ROOT: process.env["LIAISO_LLM_ROOT"],
    LIAISO_LLM_OUTPUT_DIR: process.env["LIAISO_LLM_OUTPUT_DIR"],
    LIAISO_LLM_BASE_URL: process.env["LIAISO_LLM_BASE_URL"],
    LIAISO_LLM_MODEL: process.env["LIAISO_LLM_MODEL"],
    LIAISO_LLM_NUM_CTX: process.env["LIAISO_LLM_NUM_CTX"],
    LIAISO_LLM_KEEP_ALIVE: process.env["LIAISO_LLM_KEEP_ALIVE"],
    LIAISO_LLM_TIMEOUT_MS: process.env["LIAISO_LLM_TIMEOUT_MS"],
  },
  process.cwd(),
);

if (outcome.kind === "usage") {
  stop(
    `liaiso-llm reads its model host from the environment. Missing: ${outcome.missing.join(", ")}.\nRequired: ${requiredNames.join(", ")}.`,
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
  stop(`liaiso-llm cannot open its workspace: ${detail}`, 2);
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
  process.stderr.write(`liaiso-llm: warm-up failed: ${detail}\n`);
});
