import type { GrantTtl } from "@chat/contracts/integration/grant-scope";
import type { IntegrationId } from "@chat/contracts/integration/integration";
import type {
  ApprovedTool,
  IntegrationTool,
} from "@chat/contracts/integration/tool-approval";
import type {
  IntegrationApprovalSetting,
  ToolOverrideSetting,
} from "@chat/contracts/integration/tool-approval-mode";
import { policyFor } from "@chat/contracts/tools/approval-policy";
import { isChatToolName } from "@chat/contracts/tools/tool-name";
import { Injectable } from "@nestjs/common";

import type { UserId } from "../db/ids.ts";
import {
  IntegrationToolRepository,
  type CatalogTool,
} from "./integration-tool.repository.ts";
import { exposedToolNameFor } from "./remote-tool-names.ts";
import {
  approvalKey,
  ToolApprovalRepository,
  type ApprovalRow,
} from "./tool-approval.repository.ts";

export type ApprovalChange = "changed" | "unknown_tool" | "policy_fixed";

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
   * Guard: a first-party name is recognised before the catalog is read at all.
   * The two namespaces cannot collide: a derived exposed name always begins with
   * `i<8 hex>_`, and no name in this product's vocabulary has that shape.
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

  async remember(
    userId: UserId,
    exposedName: string,
    scopeKey: string,
    ttl?: GrantTtl,
  ): Promise<ApprovalChange> {
    if (isChatToolName(exposedName)) {
      await this.approvals.rememberChatTool(userId, exposedName, scopeKey, ttl);

      return "changed";
    }

    const tool = await this.resolve(userId, exposedName);
    if (tool === undefined) {
      return "unknown_tool";
    }

    return (await this.approvals.remember(
      userId,
      tool.integrationPublicId,
      tool.remoteName,
      scopeKey,
      ttl,
    ))
      ? "changed"
      : "unknown_tool";
  }

  /**
   * Guard: a tool whose posture this product fixes is refused rather than
   * recorded. `codex_task` asks every time and `describe_workbook` never does;
   * an override the decision will never read is a setting the page would show
   * as in force when it is not.
   */
  async override(
    userId: UserId,
    exposedName: string,
    setting: ToolOverrideSetting,
  ): Promise<ApprovalChange> {
    if (isChatToolName(exposedName)) {
      if (policyFor(exposedName) !== "askable") {
        return "policy_fixed";
      }

      await this.approvals.overrideChatTool(userId, exposedName, setting);

      return "changed";
    }

    const tool = await this.resolve(userId, exposedName);
    if (tool === undefined) {
      return "unknown_tool";
    }

    return (await this.approvals.overrideRemote(
      userId,
      tool.integrationPublicId,
      tool.remoteName,
      setting,
    ))
      ? "changed"
      : "unknown_tool";
  }

  /**
   * @returns whether the integration is one this reader can see
   */
  setIntegrationMode(
    userId: UserId,
    integrationId: IntegrationId,
    setting: IntegrationApprovalSetting,
  ): Promise<boolean> {
    return this.approvals.setIntegrationMode(userId, integrationId, setting);
  }

  /**
   * @returns the integration's tools, or `undefined` when no such integration is visible
   */
  async toolsFor(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<readonly IntegrationTool[] | undefined> {
    const rows = await this.approvals.toolsFor(userId, integrationId);

    return rows?.map((row) => ({
      exposedName: exposedToolNameFor(integrationId, row.name),
      name: row.name,
      title: row.title,
      destructive: row.destructive,
      override: row.override,
      overrideStale: row.overrideStale,
    }));
  }

  async forget(userId: UserId, exposedName: string): Promise<ApprovalChange> {
    if (isChatToolName(exposedName)) {
      return (await this.approvals.forget(userId, exposedName))
        ? "changed"
        : "unknown_tool";
    }

    const tool = await this.resolve(userId, exposedName);
    if (tool === undefined) {
      return "unknown_tool";
    }

    return (await this.approvals.forget(
      userId,
      approvalKey(tool.integrationPublicId, tool.remoteName),
    ))
      ? "changed"
      : "unknown_tool";
  }

  /**
   * Guard: `definitionChanged`, `expired` and `available` are answered here
   * rather than left to the page. Each is a reason a remembered approval will
   * not be honoured, and a list that showed such a grant as live would misreport
   * what the reader consented to.
   *
   * @returns the remembered tools, or `undefined` when no such integration is visible
   */
  async listFor(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<readonly ApprovedTool[] | undefined> {
    const rows = await this.approvals.listFor(userId, integrationId);

    return rows?.map((row) =>
      project(row, exposedToolNameFor(integrationId, row.toolName), false),
    );
  }

  /**
   * The reader's grants for the tools this product ships.
   *
   * Guard: a first-party tool is named by itself on the wire. Its subject key,
   * the name the model called it by and the name the forget request carries are
   * all the same string, which is what lets both families share one route.
   */
  async listChatTools(userId: UserId): Promise<readonly ApprovedTool[]> {
    const rows = await this.approvals.listChatTools(userId);

    return rows.map((row) => project(row, row.toolName, true));
  }
}

function project(
  row: ApprovalRow,
  exposedName: string,
  firstParty: boolean,
): ApprovedTool {
  return {
    subjectKey: row.subjectKey,
    toolName: row.toolName,
    exposedName,
    firstParty,
    scope: row.scope,
    conversation: row.conversation ?? null,
    approvedAt: row.approvedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    expired: row.expired,
    definitionChanged:
      row.currentDigest !== undefined && row.currentDigest !== row.digest,
    destructive: row.destructive,
    available: row.available,
  };
}
