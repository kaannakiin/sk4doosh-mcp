import { z } from "zod";

import type { ChatToolName } from "./tool-name.ts";

/**
 * How much consent a tool needs before it runs.
 *
 * Guard: three values rather than a boolean, because "never asks" and "no grant
 * can silence it" are different postures and a boolean can only carry one. The
 * product previously spelled the first as a hardcoded allowlist and the second
 * twice — once as the remote `destructive` rule, once as a comment forbidding
 * `codex_task` from joining that allowlist — with nothing tying them together.
 */
export const toolApprovalPolicySchema = z.enum(["auto", "askable", "always"]);

export type ToolApprovalPolicy = z.infer<typeof toolApprovalPolicySchema>;

/**
 * The posture of every tool this product ships.
 *
 * Guard: typed as a total `Record`, so a tool added to `ChatToolName` without a
 * posture fails the build. The alternative — a partial map with a default —
 * would give a new tool the mildest posture by omission, which is the one
 * mistake this table exists to prevent.
 *
 * Guard: `codex_task` is `always` and must stay so. A remembered grant makes the
 * gate answer `approved`, which runs the tool inline inside a step, where the
 * sdk's chunk watchdog was armed by the model's own output and is never cleared
 * for the duration of the call — the agent would be killed at the one-minute
 * mark along with the whole turn. Requiring consent every time is what moves it
 * onto the resumed request, which runs approved tools before the step that arms
 * that watchdog exists.
 *
 * Guard: `find_tools` is `auto`. It searches only the list of servers this
 * reader connected themselves and returns names, so there is nothing to consent
 * to; asking spent a step and a prompt on every turn that had any server
 * connected.
 */
export const CHAT_TOOL_POLICY: Record<ChatToolName, ToolApprovalPolicy> = {
  describe_workbook: "auto",
  describe_document: "auto",
  find_tools: "auto",
  read_sheet: "askable",
  aggregate_sheet: "askable",
  find_in_sheet: "askable",
  read_node: "askable",
  select_xpath: "askable",
  project_records: "askable",
  codex_task: "always",
};

export function policyFor(toolName: ChatToolName): ToolApprovalPolicy {
  return CHAT_TOOL_POLICY[toolName];
}
