import { z } from "zod";

export const AGENT_APPROVAL_PART = "agent-approval";

export const AGENT_APPROVAL_HOLD_MS_DEFAULT = 5 * 60 * 1000;

export const AGENT_WORKER_CONCURRENCY_DEFAULT = 1;

export const agentApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "expired",
]);

export type AgentApprovalStatus = z.infer<typeof agentApprovalStatusSchema>;

export const agentApprovalSchema = z.object({
  approvalId: z.uuid(),
  threadId: z.string(),
  tool: z.string(),
  server: z.string(),
  reason: z.string(),
  rememberable: z.boolean(),
  status: agentApprovalStatusSchema,
  expiresAt: z.int().nonnegative(),
});

export type AgentApproval = z.infer<typeof agentApprovalSchema>;

export const agentApprovalParamsSchema = z.object({
  approvalId: z.uuid(),
});

export type AgentApprovalParams = z.infer<typeof agentApprovalParamsSchema>;

/**
 * Guard: `remembered` only widens the running turn. The grant itself is written
 * through `PUT /tool-approvals/:exposedName` like every other remembered tool;
 * the gateway reads grants once per turn, so without this flag the same tool
 * would ask again on its next call in the turn the reader just remembered it in.
 */
export const agentApprovalAnswerSchema = z.object({
  approved: z.boolean(),
  remembered: z.boolean().default(false),
});

export type AgentApprovalAnswer = z.infer<typeof agentApprovalAnswerSchema>;
