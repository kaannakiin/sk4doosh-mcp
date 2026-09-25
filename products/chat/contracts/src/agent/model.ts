import { z } from "zod";

import { sessionIdSchema } from "../chat/session.ts";
import { readinessSchema } from "../http/health.ts";

export const WORKER_MIN_CONTEXT_TOKENS = 16_384;

export const codexModelIdSchema = z.string().trim().min(1).max(128);

export type CodexModelId = z.infer<typeof codexModelIdSchema>;

export const reasoningEffortSchema = z.string().trim().min(1).max(32);

export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const workerModelIdSchema = z.string().trim().min(1).max(200);

export type WorkerModelId = z.infer<typeof workerModelIdSchema>;

export const codexModelSchema = z.object({
  id: codexModelIdSchema,
  displayName: z.string(),
  description: z.string(),
  efforts: z.array(
    z.object({ effort: reasoningEffortSchema, description: z.string() }),
  ),
  defaultEffort: reasoningEffortSchema,
  isDefault: z.boolean(),
  multiAgent: z.boolean(),
});

export type CodexModel = z.infer<typeof codexModelSchema>;

export const workerModelSchema = z.object({
  id: workerModelIdSchema,
  hostId: z.string(),
  parameterSize: z.string().nullable(),
  contextLength: z.int().positive(),
  loaded: z.boolean(),
});

export type WorkerModel = z.infer<typeof workerModelSchema>;

/**
 * A reader's model choice at one level. `null` inherits from the level above:
 * a conversation inherits the reader's default, the default inherits the
 * deployment's.
 */
export const agentSelectionSchema = z.object({
  codexModel: codexModelIdSchema.nullable(),
  effort: reasoningEffortSchema.nullable(),
  workerModel: workerModelIdSchema.nullable(),
});

export type AgentSelection = z.infer<typeof agentSelectionSchema>;

export const agentCatalogQuerySchema = z.object({
  sessionId: sessionIdSchema.optional(),
});

export type AgentCatalogQuery = z.infer<typeof agentCatalogQuerySchema>;

export const agentCatalogResponseSchema = z.object({
  codex: z.object({
    status: readinessSchema,
    models: z.array(codexModelSchema),
  }),
  worker: z.object({
    status: readinessSchema,
    models: z.array(workerModelSchema),
  }),
  selection: z.object({
    user: agentSelectionSchema,
    session: agentSelectionSchema.nullable(),
    effective: agentSelectionSchema,
  }),
});

export type AgentCatalogResponse = z.infer<typeof agentCatalogResponseSchema>;
