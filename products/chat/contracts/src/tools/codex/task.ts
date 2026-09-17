import { z } from "zod";

import {
  CODEX_ACTIVITY_MAX_CHARS,
  CODEX_INSTRUCTION_MAX_CHARS,
  CODEX_MAX_CHANGED_FILES,
  CODEX_MAX_COMMANDS,
  CODEX_MAX_INPUT_FILES,
  CODEX_MAX_TODOS,
  CODEX_SUMMARY_MAX_CHARS,
} from "./limits.ts";

export const codexTaskInputSchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(1)
    .max(CODEX_INSTRUCTION_MAX_CHARS)
    .describe(
      "What the coding agent should do, stated as a complete task. It runs in its own sandboxed directory and cannot reach the network.",
    ),
  files: z
    .array(z.string().min(1))
    .max(CODEX_MAX_INPUT_FILES)
    .optional()
    .describe(
      "Attachment paths exactly as listed in the attachment manifest. Only the files named here are copied into the agent's directory.",
    ),
});

export type CodexTaskInput = z.infer<typeof codexTaskInputSchema>;

export const codexTodoSchema = z.object({
  text: z.string().max(CODEX_ACTIVITY_MAX_CHARS),
  completed: z.boolean(),
});

export type CodexTodo = z.infer<typeof codexTodoSchema>;

/**
 * Guard: every field is bounded, because this shape is yielded repeatedly while
 * the agent runs and each yield is written to the response as it is produced.
 * An unbounded `step` echoing a command's output would turn one long turn into
 * a stream nothing downstream can buffer.
 */
export const codexProgressSchema = z.object({
  phase: z.literal("running"),
  step: z.string().max(CODEX_ACTIVITY_MAX_CHARS),
  commands: z.int().nonnegative(),
  changes: z.int().nonnegative(),
  elapsedMs: z.int().nonnegative(),
  todos: z.array(codexTodoSchema).max(CODEX_MAX_TODOS).optional(),
});

export type CodexProgress = z.infer<typeof codexProgressSchema>;

/**
 * Why a Codex run could not produce a result, as a closed vocabulary.
 *
 * Guard: nothing the agent or its subprocess wrote reaches the reader as prose.
 * A Codex failure message can quote a command's stderr, which is text this
 * product did not author but would render as its own words. The copy for each
 * member lives in the api locale files.
 */
export const codexFailureSchema = z.enum([
  "codex_unconfigured",
  "codex_binary_missing",
  "codex_unauthenticated",
  "codex_workspace_unavailable",
  "codex_timeout",
  "codex_aborted",
  "codex_failed",
]);

export type CodexFailure = z.infer<typeof codexFailureSchema>;

export const codexUsageSchema = z.object({
  inputTokens: z.int().nonnegative(),
  cachedInputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  reasoningOutputTokens: z.int().nonnegative(),
});

export type CodexUsage = z.infer<typeof codexUsageSchema>;

export const codexDoneSchema = z.object({
  phase: z.literal("done"),
  summary: z.string().max(CODEX_SUMMARY_MAX_CHARS),
  changedFiles: z.array(z.string()).max(CODEX_MAX_CHANGED_FILES),
  commands: z
    .array(z.string().max(CODEX_ACTIVITY_MAX_CHARS))
    .max(CODEX_MAX_COMMANDS),
  truncated: z.boolean(),
  usage: codexUsageSchema.optional(),
});

export type CodexDone = z.infer<typeof codexDoneSchema>;

export const codexFailedSchema = z.object({
  phase: z.literal("failed"),
  error: codexFailureSchema,
  detail: z.string().max(CODEX_ACTIVITY_MAX_CHARS).optional(),
});

export type CodexFailed = z.infer<typeof codexFailedSchema>;

export const codexTaskOutputSchema = z.discriminatedUnion("phase", [
  codexProgressSchema,
  codexDoneSchema,
  codexFailedSchema,
]);

export type CodexTaskOutput = z.infer<typeof codexTaskOutputSchema>;

export function isCodexProgress(value: unknown): value is CodexProgress {
  return codexProgressSchema.safeParse(value).success;
}
