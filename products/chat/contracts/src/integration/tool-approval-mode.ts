import { z } from "zod";

/**
 * How a reader's remembered tool approvals are consulted.
 *
 * Guard: `always_ask` suspends the remembered set, it does not empty it. A mode
 * is a switch, and a switch that destroys data cannot be flipped back.
 */
export const toolApprovalModeSchema = z.enum(["always_ask", "remember"]);

export type ToolApprovalMode = z.infer<typeof toolApprovalModeSchema>;

export function isToolApprovalMode(
  value: unknown,
): value is ToolApprovalMode {
  return toolApprovalModeSchema.safeParse(value).success;
}
