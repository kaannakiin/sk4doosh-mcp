import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import {
  decideToolApproval,
  grantCanApply,
  type ToolApprovalRequest,
  type ToolGrant,
} from "@chat/contracts/tools/approval-decision";
import { policyFor } from "@chat/contracts/tools/approval-policy";
import { isChatToolName } from "@chat/contracts/tools/tool-name";
import { Injectable } from "@nestjs/common";
import type { ToolApprovalStatus } from "ai";

import type { CatalogTool } from "../connections/integration-tool.repository.ts";
import { approvalKey } from "../connections/tool-approval.repository.ts";
import { ToolApprovalRepository } from "../connections/tool-approval.repository.ts";
import { chatToolDigest } from "../connections/tool-digest.ts";
import type { UserId } from "../db/ids.ts";
import { I18nService } from "../i18n/i18n.service.ts";

/**
 * Guard: takes no arguments payload on purpose. A remembered grant covers the
 * tool definition, never the call's `input` — approving `delete_file` once
 * approves it for every path it is ever called with. Narrowing that would mean
 * deciding which input fields are part of a tool's identity, which the tool's
 * own schema does not currently say.
 */
export type ToolApprovalGate = (
  toolName: string,
  dynamic: boolean,
) => ToolApprovalStatus;

/**
 * One turn's approval answers: the gate the model loop calls, and whether a
 * prompt for a tool should offer to remember the reader's answer.
 */
export interface TurnApproval {
  readonly gate: ToolApprovalGate;
  readonly rememberable: (toolName: string) => boolean;
}

type Posture = Omit<ToolApprovalRequest, "now">;

const NO_GRANTS: readonly ToolGrant[] = [];

@Injectable()
export class ToolApprovalGateService {
  constructor(
    private readonly approvals: ToolApprovalRepository,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Builds this turn's answer to "does the reader have to be asked about this?".
   *
   * Guard: one gate for both families. A tool this product ships and one
   * discovered on a reader's server are the same question about a different
   * subject, and answering them in two places is how this product ended up
   * asking about its own readers forever while a stranger's tool could be
   * remembered once.
   *
   * Guard: the mode and the grants are read once, before the model loop starts,
   * and the returned function is synchronous. A consent given mid-turn arrives
   * as the next request — the client resends the conversation — so there is
   * nothing to go stale inside one turn, and a database round trip inside the
   * approval callback would delay every tool call for a fact that cannot have
   * changed.
   *
   * Guard: a name that is neither in this product's vocabulary nor in the
   * reader's catalog is denied, never passed through. The decision is an
   * allowlist and never a reading of the server's own `readOnlyHint`: those are
   * hints the server supplies, and every tool this product exposes is annotated
   * read-only, so trusting them would silence reading a spreadsheet's contents.
   *
   * @param userId the subject of the trusted session
   * @param session the conversation this turn belongs to, for scoped grants
   * @param byExposedName the tools this turn offers, keyed as the model sees them
   * @param locale the language the reader is reading
   */
  async gateFor(
    userId: UserId,
    session: SessionId,
    byExposedName: ReadonlyMap<string, CatalogTool>,
    locale: Locale,
  ): Promise<TurnApproval> {
    const context = await this.approvals.contextFor(userId, session);
    const now = new Date();

    /**
     * Guard: a remote tool's policy is `askable` even when the server calls it
     * destructive. `destructive` is carried separately and still asks, but a
     * policy of `always` would also outrank the reader's own per-tool override,
     * and that override is the one way the reader may loosen such a tool.
     */
    const postureOf = (toolName: string): Posture | undefined => {
      const remote = byExposedName.get(toolName);
      if (remote !== undefined) {
        const subject = approvalKey(
          remote.integrationPublicId,
          remote.remoteName,
        );

        return {
          policy: "askable",
          mode:
            context.integrationModes.get(remote.integrationPublicId) ??
            context.mode,
          override: context.overrides.get(subject),
          destructive: remote.destructive,
          currentDigest: remote.definitionDigest,
          grants: context.grants.get(subject) ?? NO_GRANTS,
        };
      }

      if (!isChatToolName(toolName)) {
        return undefined;
      }

      return {
        policy: policyFor(toolName),
        mode: context.mode,
        override: context.overrides.get(toolName),
        destructive: false,
        currentDigest: chatToolDigest(toolName).toString("hex"),
        grants: context.grants.get(toolName) ?? NO_GRANTS,
      };
    };

    const gate: ToolApprovalGate = (toolName, dynamic) => {
      const posture = dynamic ? undefined : postureOf(toolName);
      if (posture === undefined) {
        return this.deny(locale);
      }

      const decision = decideToolApproval({ ...posture, now });
      if (decision.outcome === "allow") {
        /**
         * Guard: a tool that never asks answers `not-applicable`, not
         * `approved`. The two run the tool either way, but only one of them is
         * true — nobody granted anything for `describe_workbook`.
         */
        return decision.reason === "policy_auto"
          ? "not-applicable"
          : "approved";
      }

      const remote = byExposedName.get(toolName);

      return {
        type: "user-approval",
        reason:
          remote === undefined
            ? this.i18n.t(`chat:approval.reasons.${toolName}`, {}, locale)
            : this.i18n.t(
                "chat:tools.approval.reason",
                { server: remote.integrationName, tool: remote.remoteName },
                locale,
              ),
      };
    };

    return {
      gate,
      rememberable: (toolName) => {
        const posture = postureOf(toolName);

        return posture !== undefined && grantCanApply(posture);
      },
    };
  }

  private deny(locale: Locale): ToolApprovalStatus {
    return {
      type: "denied",
      reason: this.i18n.t("chat:approval.denied_unknown", {}, locale),
    };
  }
}
