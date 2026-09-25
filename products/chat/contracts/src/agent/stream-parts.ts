import { z } from "zod";

export const AGENT_STEP_TEXT_MAX_CHARS = 400;

export const AGENT_STEP_INPUT_MAX_CHARS = 1_500;

export const AGENT_STEP_OUTPUT_MAX_CHARS = 6_000;

export const agentStepStatusSchema = z.enum(["running", "completed", "failed"]);

export type AgentStepStatus = z.infer<typeof agentStepStatusSchema>;

const stepBase = {
  threadId: z.string(),
  status: agentStepStatusSchema,
  durationMs: z.int().nonnegative().nullable(),
};

export const agentStepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("command"),
    ...stepBase,
    command: z.string().max(AGENT_STEP_TEXT_MAX_CHARS),
    exitCode: z.int().nullable(),
  }),
  z.object({
    kind: z.literal("file_change"),
    ...stepBase,
    changes: z.array(
      z.object({
        path: z.string(),
        change: z.enum(["add", "delete", "update"]),
      }),
    ),
  }),
  z.object({
    kind: z.literal("tool_call"),
    ...stepBase,
    server: z.string(),
    tool: z.string(),
    error: z.string().max(AGENT_STEP_TEXT_MAX_CHARS).nullable(),
    /**
     * Guard: defaulted, not required. Steps stored before these fields existed
     * would otherwise fail to parse and drop out of every earlier turn.
     */
    input: z.string().max(AGENT_STEP_INPUT_MAX_CHARS).nullable().default(null),
    output: z
      .string()
      .max(AGENT_STEP_OUTPUT_MAX_CHARS)
      .nullable()
      .default(null),
    workerUsage: z
      .object({
        input: z.int().nonnegative(),
        output: z.int().nonnegative(),
      })
      .nullable(),
  }),
  z.object({
    kind: z.literal("subagent"),
    ...stepBase,
    agentThreadId: z.string(),
    path: z.string(),
  }),
  z.object({
    kind: z.literal("compaction"),
    ...stepBase,
  }),
]);

export type AgentStep = z.infer<typeof agentStepSchema>;

export const tokenUsageSchema = z.object({
  input: z.int().nonnegative(),
  cachedInput: z.int().nonnegative(),
  cacheWrite: z.int().nonnegative(),
  output: z.int().nonnegative(),
  reasoning: z.int().nonnegative(),
  total: z.int().nonnegative(),
});

export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const agentThreadTelemetrySchema = z.object({
  threadId: z.string(),
  parentThreadId: z.string().nullable(),
  path: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  usage: tokenUsageSchema,
  contextTokens: z.int().nonnegative().nullable(),
  contextWindow: z.int().positive().nullable(),
  compactions: z.int().nonnegative(),
  startedAt: z.int().nonnegative(),
  endedAt: z.int().nonnegative().nullable(),
});

export type AgentThreadTelemetry = z.infer<typeof agentThreadTelemetrySchema>;

export const rateLimitSchema = z.object({
  usedPercent: z.number().nonnegative(),
  windowMinutes: z.int().positive().nullable(),
  resetsAt: z.int().nonnegative().nullable(),
  plan: z.string().nullable(),
});

export type RateLimit = z.infer<typeof rateLimitSchema>;

export const workerTelemetrySchema = z.object({
  calls: z.int().nonnegative(),
  input: z.int().nonnegative(),
  output: z.int().nonnegative(),
  durationMs: z.int().nonnegative(),
});

export type WorkerTelemetry = z.infer<typeof workerTelemetrySchema>;

export const agentTelemetrySchema = z.object({
  model: z.string().nullable(),
  effort: z.string().nullable(),
  workerModel: z.string().nullable(),
  threads: z.array(agentThreadTelemetrySchema),
  worker: workerTelemetrySchema,
  rateLimit: rateLimitSchema.nullable(),
  startedAt: z.int().nonnegative(),
  endedAt: z.int().nonnegative().nullable(),
});

export type AgentTelemetry = z.infer<typeof agentTelemetrySchema>;

export const AGENT_STEP_PART = "agent-step";

export const AGENT_TELEMETRY_PART = "agent-telemetry";

export const AGENT_TELEMETRY_PART_ID = "telemetry";
