import { codexTaskInputSchema } from "./task.ts";

/**
 * The coding agent this product offers, declared beside the reader catalogs
 * because it is a first-party tool rather than a discovered one: its name
 * belongs in the closed `ChatToolName` vocabulary, and its approval posture is
 * decided by name like every other tool this product ships.
 */
export const CODEX_TOOL_SCHEMAS = {
  codex_task: { inputSchema: codexTaskInputSchema },
} as const;

export type CodexToolSchemas = typeof CODEX_TOOL_SCHEMAS;
