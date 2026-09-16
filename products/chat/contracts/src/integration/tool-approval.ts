import { z } from "zod";

import { exposedToolNameSchema } from "../chat/exposed-tool-name.ts";
import { remoteToolNameSchema } from "./remote-tool-name.ts";
import { toolApprovalModeSchema } from "./tool-approval-mode.ts";

/**
 * Guard: `definitionChanged`, `destructive` and `available` are answered rather
 * than left to the page to infer. All three are reasons a remembered approval
 * will not be honoured, and a list that showed a grant as live when the next
 * call will ask again is a list that misreports what the reader consented to.
 */
export const approvedToolSchema = z.object({
  toolName: remoteToolNameSchema,
  exposedName: exposedToolNameSchema,
  approvedAt: z.iso.datetime(),
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

export const updateToolApprovalModeSchema = z.object({
  mode: toolApprovalModeSchema,
});

export type UpdateToolApprovalMode = z.infer<
  typeof updateToolApprovalModeSchema
>;
