import type { ToolApprovalMode } from "./tool-approval-mode.ts";

export type RemoteApprovalReason =
  | "declared_destructive"
  | "mode_always_ask"
  | "not_remembered"
  | "definition_changed"
  | "remembered";

export interface RemoteApprovalDecision {
  readonly outcome: "ask" | "allow";
  readonly reason: RemoteApprovalReason;
}

export interface RemoteApprovalRequest {
  readonly mode: ToolApprovalMode;
  readonly destructive: boolean;
  readonly currentDigest: string;
  readonly rememberedDigest: string | undefined;
}

/**
 * Guard: total over `ToolApprovalMode`, so a third mode has to declare its
 * posture rather than inherit one by falling through. A `switch` would return
 * `undefined` for an unhandled mode, and an absent answer reads downstream as
 * permission.
 */
const ASKS_ALWAYS: Record<ToolApprovalMode, boolean> = {
  always_ask: true,
  remember: false,
};

/**
 * Decides whether a remote tool call needs the reader's consent this time.
 *
 * Guard: the destructive check comes first and no remembered approval survives
 * it. Remembering is a convenience for calls the reader would approve again
 * without reading them; a call the server itself says can destroy data is not
 * one of those, whatever was clicked a month ago.
 *
 * Guard: the digest is compared, not merely the tool's presence. A server can
 * keep a name and change what it does — a description edit is the cheapest way
 * to turn a tool the reader approved into one that reports elsewhere — and the
 * approval was given for the definition that was read, not for the name.
 *
 * @param request the reader's mode, the server's claim, and the two digests
 * @returns whether to ask, and which rule decided it
 */
export function decideRemoteApproval(
  request: RemoteApprovalRequest,
): RemoteApprovalDecision {
  if (request.destructive) {
    return { outcome: "ask", reason: "declared_destructive" };
  }

  if (ASKS_ALWAYS[request.mode]) {
    return { outcome: "ask", reason: "mode_always_ask" };
  }

  if (request.rememberedDigest === undefined) {
    return { outcome: "ask", reason: "not_remembered" };
  }

  if (request.rememberedDigest !== request.currentDigest) {
    return { outcome: "ask", reason: "definition_changed" };
  }

  return { outcome: "allow", reason: "remembered" };
}
