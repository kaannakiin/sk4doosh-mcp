import type { ToolApprovalMode } from "../integration/tool-approval-mode.ts";
import type { ToolApprovalPolicy } from "./approval-policy.ts";

export type ToolApprovalReason =
  | "policy_auto"
  | "policy_always"
  | "declared_destructive"
  | "mode_always_ask"
  | "not_remembered"
  | "grant_expired"
  | "definition_changed"
  | "remembered";

export interface ToolApprovalDecision {
  readonly outcome: "ask" | "allow";
  readonly reason: ToolApprovalReason;
}

/**
 * One remembered grant, as it was written.
 *
 * Guard: the expiry travels per row rather than collapsed into one date. A
 * subject can carry an everywhere grant and a conversation-scoped one at the
 * same time, given on different days under different settings, and a single
 * date would have to pick one of them to believe.
 */
export interface ToolGrant {
  readonly digest: string;
  readonly expiresAt: Date | undefined;
}

export interface ToolApprovalRequest {
  readonly policy: ToolApprovalPolicy;
  readonly mode: ToolApprovalMode;
  readonly destructive: boolean;
  readonly currentDigest: string;
  readonly grants: readonly ToolGrant[];
  readonly now: Date;
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
 * Whether a tool call needs the reader's consent this time.
 *
 * Guard: one function for both families. A first-party tool and a discovered one
 * are the same question asked about a different subject, and answering them in
 * two places is how the product ended up trusting its own readers less than a
 * server it had never met — the discovered tool could be remembered, the shipped
 * one asked forever.
 *
 * Guard: `policy` outranks everything, in both directions. `auto` short-circuits
 * before the grant is even read, and `always` before any grant can silence it —
 * so a tool that must never run unasked cannot be quietened by a row in a table.
 *
 * Guard: the digest is compared, not merely the grant's presence. A definition
 * can change under a name it keeps, and the consent was given for the definition
 * the reader read. Every live grant is consulted rather than one chosen by
 * precedence: a subject can carry both an everywhere grant and one scoped to
 * this conversation, and ranking them would let a stale row shadow the fresh
 * re-grant given after the definition changed.
 *
 * Guard: "expired" is reported apart from "never remembered". They lead to the
 * same prompt but not to the same sentence — a reader whose grant lapsed is
 * being asked again, not asked for the first time, and the listing renders the
 * two differently.
 *
 * @param request the tool's posture, the reader's mode, and what was remembered
 * @returns whether to ask, and which rule decided it
 */
export function decideToolApproval(
  request: ToolApprovalRequest,
): ToolApprovalDecision {
  if (request.policy === "auto") {
    return { outcome: "allow", reason: "policy_auto" };
  }

  if (request.policy === "always") {
    return { outcome: "ask", reason: "policy_always" };
  }

  if (request.destructive) {
    return { outcome: "ask", reason: "declared_destructive" };
  }

  if (ASKS_ALWAYS[request.mode]) {
    return { outcome: "ask", reason: "mode_always_ask" };
  }

  if (request.grants.length === 0) {
    return { outcome: "ask", reason: "not_remembered" };
  }

  const live = request.grants.filter(
    (grant) =>
      grant.expiresAt === undefined ||
      grant.expiresAt.getTime() > request.now.getTime(),
  );

  if (live.length === 0) {
    return { outcome: "ask", reason: "grant_expired" };
  }

  if (!live.some((grant) => grant.digest === request.currentDigest)) {
    return { outcome: "ask", reason: "definition_changed" };
  }

  return { outcome: "allow", reason: "remembered" };
}
