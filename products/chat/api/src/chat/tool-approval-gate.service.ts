import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { decideToolApproval } from "@chat/contracts/tools/approval-decision";
import type { ToolGrant } from "@chat/contracts/tools/approval-decision";
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

export type ToolApprovalGate = (
  toolName: string,
  dynamic: boolean,
) => ToolApprovalStatus;

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
  ): Promise<ToolApprovalGate> {
    const [mode, grants] = await Promise.all([
      this.approvals.modeFor(userId),
      this.approvals.grantsFor(userId, session),
    ]);
    const now = new Date();

    return (toolName, dynamic) => {
      if (dynamic) {
        return this.deny(locale);
      }

      const remote = byExposedName.get(toolName);
      if (remote !== undefined) {
        const decision = decideToolApproval({
          policy: remote.destructive ? "always" : "askable",
          mode,
          destructive: remote.destructive,
          currentDigest: remote.definitionDigest,
          grants:
            grants.get(
              approvalKey(remote.integrationPublicId, remote.remoteName),
            ) ?? NO_GRANTS,
          now,
        });

        return decision.outcome === "allow"
          ? "approved"
          : {
              type: "user-approval",
              reason: this.i18n.t(
                "chat:tools.approval.reason",
                { server: remote.integrationName, tool: remote.remoteName },
                locale,
              ),
            };
      }

      if (!isChatToolName(toolName)) {
        return this.deny(locale);
      }

      const decision = decideToolApproval({
        policy: policyFor(toolName),
        mode,
        destructive: false,
        currentDigest: chatToolDigest(toolName).toString("hex"),
        grants: grants.get(toolName) ?? NO_GRANTS,
        now,
      });

      if (decision.outcome === "allow") {
        /**
         * Guard: a tool that never asks answers `not-applicable`, not
         * `approved`. The two run the tool either way, but only one of them is
         * true — nobody granted anything for `describe_workbook`.
         */
        return decision.reason === "policy_auto" ? "not-applicable" : "approved";
      }

      return {
        type: "user-approval",
        reason: this.i18n.t(
          `chat:approval.reasons.${toolName}`,
          {},
          locale,
        ),
      };
    };
  }

  private deny(locale: Locale): ToolApprovalStatus {
    return {
      type: "denied",
      reason: this.i18n.t("chat:approval.denied_unknown", {}, locale),
    };
  }
}
