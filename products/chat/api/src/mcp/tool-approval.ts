import {
  isChatToolName,
  type ChatToolName,
} from "@chat/contracts/tools/tool-name";
import type { ToolApprovalStatus } from "ai";

/**
 * The two tools that only report structure — sheet names, namespaces, element
 * counts — and never return cell or record values.
 *
 * Guard: `codex_task` must never join this set, and not only because it writes
 * files. A tool that skips approval executes inline inside a step, where the
 * sdk's chunk watchdog has been armed by the model's own output and is never
 * cleared for the duration of the call — an agent run would be killed at the
 * one-minute mark with the whole turn. Requiring approval moves it onto the
 * resumed request, which executes approved tools before the step that arms that
 * watchdog exists. `tool-approval.spec.ts` holds this.
 */
const AUTO_APPROVED = new Set<ChatToolName>([
  "describe_workbook",
  "describe_document",
]);

export interface ApprovalRequest {
  readonly toolName: string;
  readonly dynamic: boolean;
}

export type ReasonLookup = (key: string) => string;

/**
 * Guard: the decision is an allowlist, never a reading of the MCP server's own
 * `readOnlyHint`. Those annotations are hints supplied by the server, and every
 * tool this product exposes is annotated read-only, so trusting them would
 * auto-approve reading a spreadsheet's contents. A name that is not on the list
 * — including any dynamically discovered tool — is denied rather than passed
 * through, so adding a reader server cannot silently widen what runs unasked.
 */
export function approvalFor(
  request: ApprovalRequest,
  reason: ReasonLookup,
): ToolApprovalStatus {
  if (request.dynamic || !isChatToolName(request.toolName)) {
    return { type: "denied", reason: reason("chat:approval.denied_unknown") };
  }

  if (AUTO_APPROVED.has(request.toolName)) {
    return "not-applicable";
  }

  return {
    type: "user-approval",
    reason: reason(`chat:approval.reasons.${request.toolName}`),
  };
}
