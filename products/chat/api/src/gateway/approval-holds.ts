import type { AgentApprovalAnswer } from "@chat/contracts/agent/approval";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import type { AppConfig } from "../config/configuration.ts";
import type { UserId } from "../db/ids.ts";

export type HoldOutcome =
  | { readonly status: "approved"; readonly remembered: boolean }
  | { readonly status: "denied" }
  | { readonly status: "expired" };

export interface Hold {
  readonly approvalId: string;
  readonly expiresAt: number;
  readonly outcome: Promise<HoldOutcome>;
}

interface Pending {
  readonly userId: UserId;
  readonly settle: (outcome: HoldOutcome) => void;
}

/**
 * The tool calls waiting on the reader's consent, across every running turn.
 *
 * Guard: an unanswered hold expires on this side, well inside the gateway's
 * `tool_timeout_sec`, and an expired hold never runs. Measured on codex 0.154:
 * when that timeout passes codex marks the call failed but neither closes the
 * HTTP request nor sends a cancellation, so a consent that arrived after it
 * would run a call the agent had already given up on and reported as failed.
 */
@Injectable()
export class ApprovalHolds {
  private readonly pending = new Map<string, Pending>();

  readonly holdMs: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.holdMs = config.get("gateway", { infer: true }).approvalHoldMs;
  }

  /**
   * Opens a hold for one call.
   *
   * @param userId the only reader whose answer settles it
   * @param signal the turn's; its end expires the hold
   * @returns the id the page answers with and the outcome to wait on
   */
  hold(userId: UserId, signal: AbortSignal): Hold {
    const approvalId = randomUUID();
    const expiresAt = Date.now() + this.holdMs;
    const outcome = new Promise<HoldOutcome>((resolve) => {
      const timer = setTimeout(
        () => settle({ status: "expired" }),
        this.holdMs,
      );
      const expire = () => settle({ status: "expired" });
      const settle = (value: HoldOutcome) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", expire);
        this.pending.delete(approvalId);
        resolve(value);
      };
      if (signal.aborted) {
        settle({ status: "expired" });

        return;
      }
      signal.addEventListener("abort", expire, { once: true });
      this.pending.set(approvalId, { userId, settle });
    });

    return { approvalId, expiresAt, outcome };
  }

  /**
   * Settles a hold with the reader's answer.
   *
   * Guard: a hold owned by someone else answers exactly like one that does not
   * exist, so the response cannot be used to probe another reader's approvals.
   *
   * @returns whether a hold of this reader's was settled
   */
  answer(
    userId: UserId,
    approvalId: string,
    answer: AgentApprovalAnswer,
  ): boolean {
    const pending = this.pending.get(approvalId);
    if (pending === undefined || pending.userId !== userId) {
      return false;
    }

    pending.settle(
      answer.approved
        ? { status: "approved", remembered: answer.remembered }
        : { status: "denied" },
    );

    return true;
  }
}
