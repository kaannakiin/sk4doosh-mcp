import type { IntegrationId } from "@chat/contracts/integration/integration";
import type { ApprovedTool } from "@chat/contracts/integration/tool-approval";
import { Injectable } from "@nestjs/common";

import type { UserId } from "../db/ids.ts";
import {
  IntegrationToolRepository,
  type CatalogTool,
} from "./integration-tool.repository.ts";
import { exposedToolNameFor } from "./remote-tool-names.ts";
import { ToolApprovalRepository } from "./tool-approval.repository.ts";

export type ApprovalChange = "changed" | "unknown_tool";

@Injectable()
export class ToolApprovalService {
  constructor(
    private readonly approvals: ToolApprovalRepository,
    private readonly tools: IntegrationToolRepository,
  ) {}

  /**
   * Guard: the exposed name is resolved by rebuilding this reader's own catalog
   * and re-deriving the names, never by splitting the string. The browser only
   * ever sees the exposed name — the approval part the AI SDK renders carries no
   * integration — so this is the one place that can turn it back into a row, and
   * a parser would let a caller name a pair that was never offered to them.
   *
   * @param userId the subject of the trusted session
   * @param exposedName the name the model was offered the tool under
   * @returns the catalog row, or `undefined` when this reader has no such tool
   */
  private async resolve(
    userId: UserId,
    exposedName: string,
  ): Promise<CatalogTool | undefined> {
    const catalog = await this.tools.catalogFor(userId);

    return catalog.find(
      (entry) =>
        exposedToolNameFor(entry.integrationPublicId, entry.remoteName) ===
        exposedName,
    );
  }

  async remember(userId: UserId, exposedName: string): Promise<ApprovalChange> {
    const tool = await this.resolve(userId, exposedName);
    if (tool === undefined) {
      return "unknown_tool";
    }

    return (await this.approvals.remember(
      userId,
      tool.integrationPublicId,
      tool.remoteName,
    ))
      ? "changed"
      : "unknown_tool";
  }

  async forget(userId: UserId, exposedName: string): Promise<ApprovalChange> {
    const tool = await this.resolve(userId, exposedName);
    if (tool === undefined) {
      return "unknown_tool";
    }

    return (await this.approvals.forget(
      userId,
      tool.integrationPublicId,
      tool.remoteName,
    ))
      ? "changed"
      : "unknown_tool";
  }

  /**
   * Guard: `definitionChanged` is answered here rather than left to the page.
   * A grant whose digest no longer matches will ask again on the next call, and
   * a list that showed it as live would misreport what the reader consented to.
   *
   * @param userId the subject of the trusted session
   * @param integrationId the integration to list
   * @returns the remembered tools, or `undefined` when no such integration is visible
   */
  async listFor(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<readonly ApprovedTool[] | undefined> {
    const rows = await this.approvals.listFor(userId, integrationId);

    return rows?.map((row) => ({
      toolName: row.toolName,
      exposedName: exposedToolNameFor(integrationId, row.toolName),
      approvedAt: row.approvedAt.toISOString(),
      definitionChanged:
        row.currentDigest !== undefined && row.currentDigest !== row.digest,
      destructive: row.destructive,
      available: row.available,
    }));
  }
}
