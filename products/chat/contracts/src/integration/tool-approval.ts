import { z } from "zod";

import { exposedToolNameSchema } from "../chat/exposed-tool-name.ts";
import { sessionIdSchema } from "../chat/session.ts";
import { grantScopeSchema, grantTtlSchema } from "./grant-scope.ts";
import { toolApprovalModeSchema } from "./tool-approval-mode.ts";

/**
 * Guard: `definitionChanged`, `destructive`, `available` and `expired` are
 * answered rather than left to the page to infer. All four are reasons a
 * remembered approval will not be honoured, and a list that showed a grant as
 * live when the next call will ask again is a list that misreports what the
 * reader consented to.
 */
export const approvedToolSchema = z.object({
  subjectKey: z.string().min(1).max(200),
  toolName: z.string().min(1).max(128),
  /**
   * The name the reader saw the tool under, and the one the forget request
   * carries. A first-party tool is named by itself; a discovered one by the
   * prefixed name it was offered to the model under.
   */
  exposedName: exposedToolNameSchema,
  firstParty: z.boolean(),
  scope: grantScopeSchema,
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  expired: z.boolean(),
  definitionChanged: z.boolean(),
  destructive: z.boolean(),
  available: z.boolean(),
});

export type ApprovedTool = z.infer<typeof approvedToolSchema>;

export const approvedToolListResponseSchema = z.object({
  approvals: z.array(approvedToolSchema),
});

export type ApprovedToolListResponse = z.infer<
  typeof approvedToolListResponseSchema
>;

export const toolApprovalParamsSchema = z.object({
  exposedName: exposedToolNameSchema,
});

export type ToolApprovalParams = z.infer<typeof toolApprovalParamsSchema>;

/**
 * Guard: a conversation-scoped grant must name its conversation, and a global
 * one must not. Accepting a session id on a global grant would record a scope
 * the decision never reads, which is a row that says something untrue about
 * what the reader chose.
 */
export const rememberToolSchema = z
  .object({
    scope: grantScopeSchema,
    sessionId: sessionIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "session" && value.sessionId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionId"],
        message: "a conversation-scoped grant must name its conversation",
      });
    }

    if (value.scope === "global" && value.sessionId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionId"],
        message: "a grant that reaches everywhere names no conversation",
      });
    }
  });

export type RememberTool = z.infer<typeof rememberToolSchema>;

export const updateToolApprovalModeSchema = z.object({
  mode: toolApprovalModeSchema,
});

export type UpdateToolApprovalMode = z.infer<
  typeof updateToolApprovalModeSchema
>;

export const updateGrantTtlSchema = z.object({
  ttl: grantTtlSchema,
});

export type UpdateGrantTtl = z.infer<typeof updateGrantTtlSchema>;
