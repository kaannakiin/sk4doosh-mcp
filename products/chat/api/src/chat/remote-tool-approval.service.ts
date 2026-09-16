import type { Locale } from "@chat/contracts/common/locale";
import { decideRemoteApproval } from "@chat/contracts/integration/remote-approval-decision";
import { Injectable } from "@nestjs/common";
import type { ToolApprovalStatus } from "ai";

import type { CatalogTool } from "../connections/integration-tool.repository.ts";
import {
  ToolApprovalRepository,
  approvalKey,
} from "../connections/tool-approval.repository.ts";
import type { UserId } from "../db/ids.ts";
import { I18nService } from "../i18n/i18n.service.ts";

export type RemoteApprovalGate = (
  exposedName: string,
) => ToolApprovalStatus | undefined;

@Injectable()
export class RemoteToolApprovalService {
  constructor(
    private readonly approvals: ToolApprovalRepository,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Builds this turn's answer to "does the reader have to be asked about this?".
   *
   * Guard: the mode and the remembered digests are read once, before the model
   * loop starts, and the returned function is synchronous. A consent given
   * mid-turn arrives as the next request — the client resends the conversation —
   * so there is nothing to go stale inside one turn, and a database round trip
   * inside the approval callback would delay every tool call for a fact that
   * cannot have changed.
   *
   * Guard: a name that is not a remote tool returns `undefined`, so the local
   * reader tools keep going through `approvalFor` unchanged. This gate widens
   * nothing: it only decides for tools that did not exist at compile time.
   *
   * @param userId the subject of the trusted session
   * @param byExposedName the tools this turn offers, keyed as the model sees them
   * @param locale the language the reader is reading
   * @returns a gate over exposed names, or `undefined` for names it does not own
   */
  async gateFor(
    userId: UserId,
    byExposedName: ReadonlyMap<string, CatalogTool>,
    locale: Locale,
  ): Promise<RemoteApprovalGate> {
    const [mode, remembered] = await Promise.all([
      this.approvals.modeFor(userId),
      this.approvals.digestsFor(userId),
    ]);

    return (exposedName) => {
      const tool = byExposedName.get(exposedName);
      if (tool === undefined) {
        return undefined;
      }

      const decision = decideRemoteApproval({
        mode,
        destructive: tool.destructive,
        currentDigest: tool.definitionDigest,
        rememberedDigest: remembered.get(
          approvalKey(tool.integrationPublicId, tool.remoteName),
        ),
      });

      if (decision.outcome === "allow") {
        return "approved";
      }

      return {
        type: "user-approval",
        reason: this.i18n.t(
          "chat:tools.approval.reason",
          { server: tool.integrationName, tool: tool.remoteName },
          locale,
        ),
      };
    };
  }
}
