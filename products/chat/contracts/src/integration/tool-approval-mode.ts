import { z } from "zod";

/**
 * How a reader's remembered tool approvals are consulted.
 *
 * Guard: `always_ask` suspends the remembered set, it does not empty it. A mode
 * is a switch, and a switch that destroys data cannot be flipped back.
 */
export const toolApprovalModeSchema = z.enum(["always_ask", "remember"]);

export type ToolApprovalMode = z.infer<typeof toolApprovalModeSchema>;

export function isToolApprovalMode(value: unknown): value is ToolApprovalMode {
  return toolApprovalModeSchema.safeParse(value).success;
}

/**
 * How one reader wants one integration's tools approved, in place of their own
 * mode.
 *
 * Guard: `auto` exists only here, never as a reader's own mode. Running every
 * tool of every server unasked is not a posture this product offers in one
 * switch; trusting one server is.
 */
export const integrationApprovalModeSchema = z.enum([
  "always_ask",
  "remember",
  "auto",
]);

export type IntegrationApprovalMode = z.infer<
  typeof integrationApprovalModeSchema
>;

/**
 * An integration's setting as the page edits it: `inherit` is the absence of a
 * row, so the reader's own mode applies.
 */
export const integrationApprovalSettingSchema = z.enum([
  "inherit",
  ...integrationApprovalModeSchema.options,
]);

export type IntegrationApprovalSetting = z.infer<
  typeof integrationApprovalSettingSchema
>;

export const toolOverrideModeSchema = z.enum(["always_ask", "auto"]);

export type ToolOverrideMode = z.infer<typeof toolOverrideModeSchema>;

export const toolOverrideSettingSchema = z.enum([
  "inherit",
  ...toolOverrideModeSchema.options,
]);

export type ToolOverrideSetting = z.infer<typeof toolOverrideSettingSchema>;
