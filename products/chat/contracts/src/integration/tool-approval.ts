import { z } from "zod";

import { exposedToolNameSchema } from "../chat/exposed-tool-name.ts";
import { sessionIdSchema } from "../chat/session.ts";
import { toolApprovalPolicySchema } from "../tools/approval-policy.ts";
import { chatToolNameSchema } from "../tools/tool-name.ts";
import { grantScopeSchema, grantTtlSchema } from "./grant-scope.ts";
import {
  integrationApprovalSettingSchema,
  toolApprovalModeSchema,
  toolOverrideSettingSchema,
} from "./tool-approval-mode.ts";

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
  /**
   * The conversation a `session` grant is limited to, `null` for a global one.
   * The settings page is outside every conversation, so "this conversation"
   * there names none of them.
   */
  conversation: z
    .object({ id: sessionIdSchema, title: z.string().nullable() })
    .nullable(),
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
    /** Absent means the reader's own preference. */
    ttl: grantTtlSchema.optional(),
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

export const updateIntegrationApprovalModeSchema = z.object({
  mode: integrationApprovalSettingSchema,
});

export type UpdateIntegrationApprovalMode = z.infer<
  typeof updateIntegrationApprovalModeSchema
>;

export const updateToolOverrideSchema = z.object({
  mode: toolOverrideSettingSchema,
});

export type UpdateToolOverride = z.infer<typeof updateToolOverrideSchema>;

/**
 * One standing decision applied to several tools of one integration, named by
 * the remote name each tool carries on that server.
 *
 * Guard: all or nothing. A name the integration does not offer refuses the whole
 * request, so a bulk change the reader confirmed is never recorded for a part of
 * the selection they did not see fail.
 */
export const updateToolOverridesSchema = z.object({
  mode: toolOverrideSettingSchema,
  names: z.array(z.string().min(1).max(128)).min(1).max(1000),
});

export type UpdateToolOverrides = z.infer<typeof updateToolOverridesSchema>;

/**
 * One tool of an integration, with the reader's standing decision about it.
 *
 * Guard: `overrideStale` is answered rather than left to the page. An `auto`
 * override given for a definition the server has since rewritten asks again,
 * and a page that showed it as "never asks" would misreport what runs unasked.
 */
export const integrationToolSchema = z.object({
  exposedName: exposedToolNameSchema,
  name: z.string().min(1).max(128),
  title: z.string().nullable(),
  description: z.string().nullable(),
  destructive: z.boolean(),
  override: toolOverrideSettingSchema,
  overrideStale: z.boolean(),
});

export type IntegrationTool = z.infer<typeof integrationToolSchema>;

export const integrationToolListResponseSchema = z.object({
  tools: z.array(integrationToolSchema),
});

export type IntegrationToolListResponse = z.infer<
  typeof integrationToolListResponseSchema
>;

/**
 * One tool this product ships, with its fixed posture and the reader's standing
 * decision about it.
 *
 * Guard: every shipped tool is listed, not only the remembered ones. A tool that
 * never asks and one that always asks can carry no grant, so a page built from
 * grants alone could never show the reader either of them.
 */
export const chatToolEntrySchema = z.object({
  name: chatToolNameSchema,
  policy: toolApprovalPolicySchema,
  override: toolOverrideSettingSchema,
  overrideStale: z.boolean(),
});

export type ChatToolEntry = z.infer<typeof chatToolEntrySchema>;

export const chatToolListResponseSchema = z.object({
  tools: z.array(chatToolEntrySchema),
});

export type ChatToolListResponse = z.infer<typeof chatToolListResponseSchema>;
