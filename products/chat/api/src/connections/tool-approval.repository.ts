import type { SessionId } from "@chat/contracts/chat/session";
import type { GrantScope, GrantTtl } from "@chat/contracts/integration/grant-scope";
import { grantExpiryFor } from "@chat/contracts/integration/grant-scope";
import type { IntegrationId } from "@chat/contracts/integration/integration";
import type { ToolApprovalMode } from "@chat/contracts/integration/tool-approval-mode";
import type { ToolGrant } from "@chat/contracts/tools/approval-decision";
import {
  isChatToolName,
  type ChatToolName,
} from "@chat/contracts/tools/tool-name";
import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import type { UserId } from "../db/ids.ts";
import { visibleToUser } from "./connection-rows.ts";
import { chatToolDigest } from "./tool-digest.ts";

export interface RememberedApproval {
  readonly toolName: string;
  readonly approvedAt: Date;
  readonly digest: string;
}

export interface ApprovalRow extends RememberedApproval {
  readonly subjectKey: string;
  readonly scope: GrantScope;
  readonly expiresAt: Date | undefined;
  readonly expired: boolean;
  readonly available: boolean;
  readonly destructive: boolean;
  readonly currentDigest: string | undefined;
}

/**
 * Guard: `''` is the scope that reaches everywhere, and it is a value rather
 * than a null because it sits in the primary key. The model's own comment
 * carries the rest of the reasoning.
 */
export const GLOBAL_SCOPE = "";

export function scopeKeyFor(
  scope: GrantScope,
  session: SessionId | undefined,
): string {
  return scope === "global" ? GLOBAL_SCOPE : (session ?? GLOBAL_SCOPE);
}

/**
 * Guard: the two halves are joined by a colon, which neither can contain — an
 * integration id is a uuid and a tool name is `[A-Za-z0-9_.-]`. A separator
 * either side could carry would let one pair's key collide with another's.
 */
export function approvalKey(
  integrationId: IntegrationId,
  toolName: string,
): string {
  return `${integrationId}:${toolName}`;
}

@Injectable()
export class ToolApprovalRepository {
  constructor(private readonly db: DbService) {}

  /**
   * Guard: the mode is stored on the reader rather than derived from anything.
   * A mode that could be inferred is a mode a bug can widen, and this one
   * decides whether a tool runs without being asked about.
   *
   * @param userId the subject of the trusted session
   * @returns how this reader's remembered approvals are to be consulted
   */
  async modeFor(userId: UserId): Promise<ToolApprovalMode> {
    const row = await this.db.client.user.findUniqueOrThrow({
      where: { id: BigInt(userId) },
      select: { toolApprovalMode: true },
    });

    return row.toolApprovalMode;
  }

  /**
   * @param userId the subject of the trusted session
   * @param mode how the reader wants remembered approvals consulted
   */
  async setMode(userId: UserId, mode: ToolApprovalMode): Promise<void> {
    await this.db.client.user.update({
      where: { id: BigInt(userId) },
      data: { toolApprovalMode: mode },
    });
  }

  /**
   * Every grant this reader holds that could apply to this turn.
   *
   * Guard: read once per turn rather than per tool call. The approval callback
   * runs inside the model loop, and a database round trip there would sit
   * between the model choosing a tool and the reader being asked about it.
   *
   * Guard: the scope filter is applied here rather than in the decision, so a
   * grant scoped to another conversation is not merely outranked — it is never
   * loaded, and cannot be reasoned about by mistake.
   *
   * Guard: a subject can hold more than one grant, one reaching everywhere and
   * one scoped to this conversation, written on different days under different
   * settings. Every one is returned; the decision consults them all rather than
   * ranking them, because the narrow one is typically the newer.
   *
   * @param userId the subject of the trusted session
   * @param session the conversation this turn belongs to
   * @returns the live grants for each subject key
   */
  async grantsFor(
    userId: UserId,
    session: SessionId,
  ): Promise<ReadonlyMap<string, readonly ToolGrant[]>> {
    const rows = await this.db.client.toolApproval.findMany({
      where: {
        userId: BigInt(userId),
        scopeKey: { in: [GLOBAL_SCOPE, session] },
      },
      select: { subjectKey: true, definitionDigest: true, expiresAt: true },
    });

    const grants = new Map<string, ToolGrant[]>();
    for (const row of rows) {
      const held = grants.get(row.subjectKey) ?? [];
      held.push({
        digest: Buffer.from(row.definitionDigest).toString("hex"),
        expiresAt: row.expiresAt ?? undefined,
      });
      grants.set(row.subjectKey, held);
    }

    return grants;
  }

  async ttlFor(userId: UserId): Promise<GrantTtl> {
    const row = await this.db.client.user.findUniqueOrThrow({
      where: { id: BigInt(userId) },
      select: { grantTtl: true },
    });

    return row.grantTtl;
  }

  async setTtl(userId: UserId, ttl: GrantTtl): Promise<void> {
    await this.db.client.user.update({
      where: { id: BigInt(userId) },
      data: { grantTtl: ttl },
    });
  }

  /**
   * Records that the reader does not want to be asked about a tool this product
   * ships again.
   *
   * Guard: the digest comes from the contract layer, not from the caller. It is
   * the same rule the remote branch follows for the same reason — a
   * client-supplied digest is a client-supplied grant.
   *
   * @param toolName a tool in this product's own closed vocabulary
   * @param scopeKey the conversation this grant is limited to, or `''`
   */
  async rememberChatTool(
    userId: UserId,
    toolName: ChatToolName,
    scopeKey: string,
  ): Promise<void> {
    const digest = Uint8Array.from(chatToolDigest(toolName));
    const expiresAt = grantExpiryFor(await this.ttlFor(userId), new Date());

    await this.db.client.toolApproval.upsert({
      where: {
        userId_subjectKey_scopeKey: {
          userId: BigInt(userId),
          subjectKey: toolName,
          scopeKey,
        },
      },
      create: {
        userId: BigInt(userId),
        subjectKey: toolName,
        scopeKey,
        integrationId: null,
        toolName,
        definitionDigest: digest,
        expiresAt,
      },
      update: { definitionDigest: digest, expiresAt },
    });
  }

  /**
   * Records that the reader does not want to be asked about this tool again.
   *
   * Guard: the digest is read from the tool row inside this call, never taken
   * from the caller. A client-supplied digest is a client-supplied grant — it
   * would let a page remember consent for a definition the server never
   * published.
   *
   * Guard: the integration is resolved through the same visibility filter every
   * other path uses, so a reader cannot record an approval against a private
   * server they do not own and learn from the answer that it exists.
   *
   * Guard: `subject_key` and `integration_id` are written from this one resolved
   * row. Nothing downstream can check that the two agree — a CHECK would need a
   * subquery — so writing them together here is the whole of that guarantee.
   *
   * @param scopeKey the conversation this grant is limited to, or `''`
   * @returns whether the tool was there to be remembered
   */
  async remember(
    userId: UserId,
    integrationId: IntegrationId,
    toolName: string,
    scopeKey: string,
  ): Promise<boolean> {
    const integration = await this.db.client.integration.findFirst({
      where: visibleToUser(userId, integrationId),
      select: { id: true, tools: { where: { name: toolName } } },
    });

    const [tool] = integration?.tools ?? [];
    if (integration === null || tool === undefined) {
      return false;
    }

    const digest = Buffer.from(tool.definitionDigest);
    const subjectKey = approvalKey(integrationId, toolName);
    const expiresAt = grantExpiryFor(await this.ttlFor(userId), new Date());

    await this.db.client.toolApproval.upsert({
      where: {
        userId_subjectKey_scopeKey: {
          userId: BigInt(userId),
          subjectKey,
          scopeKey,
        },
      },
      create: {
        userId: BigInt(userId),
        subjectKey,
        scopeKey,
        integrationId: integration.id,
        toolName,
        definitionDigest: digest,
        expiresAt,
      },
      update: { definitionDigest: digest, expiresAt },
    });

    return true;
  }

  /**
   * Guard: forgetting drops every scope at once. The reader asking to be asked
   * again is not saying "in this conversation only" — a grant left standing
   * somewhere else would make the next conversation silently disagree with the
   * page they just used.
   *
   * @returns whether any grant was there to remove
   */
  async forget(userId: UserId, subjectKey: string): Promise<boolean> {
    const { count } = await this.db.client.toolApproval.deleteMany({
      where: { userId: BigInt(userId), subjectKey },
    });

    return count > 0;
  }

  /**
   * What the reader has remembered for one integration, and whether each grant
   * is still live.
   *
   * Guard: a tool the server has withdrawn is reported, not swept. Approvals are
   * permanent by decision, and a server that answers with an empty list during
   * an outage must not be able to erase consent — so the join answers
   * `available` instead of a reaper deleting rows. An expired grant is the same
   * family and is reported the same way.
   *
   * @returns one row per remembered tool, or `undefined` when no such integration is visible
   */
  async listFor(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<readonly ApprovalRow[] | undefined> {
    const integration = await this.db.client.integration.findFirst({
      where: visibleToUser(userId, integrationId),
      select: {
        id: true,
        tools: {
          select: { name: true, destructive: true, definitionDigest: true },
        },
      },
    });

    if (integration === null) {
      return undefined;
    }

    const current = new Map(
      integration.tools.map((tool) => [
        tool.name,
        {
          destructive: tool.destructive,
          digest: Buffer.from(tool.definitionDigest).toString("hex"),
        },
      ]),
    );

    const rows = await this.db.client.toolApproval.findMany({
      where: { userId: BigInt(userId), integrationId: integration.id },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => {
      const live = current.get(row.toolName);

      return toApprovalRow(row, live?.destructive ?? false, live !== undefined, live?.digest);
    });
  }

  /**
   * The grants this reader holds for the tools this product ships.
   *
   * Guard: read by the absence of an integration rather than by matching names
   * against the vocabulary. A row whose tool has since left `ChatToolName` still
   * belongs to the reader and still has to be listable, or it becomes consent
   * they cannot withdraw.
   */
  async listChatTools(userId: UserId): Promise<readonly ApprovalRow[]> {
    const rows = await this.db.client.toolApproval.findMany({
      where: { userId: BigInt(userId), integrationId: null },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => {
      const name = row.toolName;

      return toApprovalRow(
        row,
        false,
        isChatToolName(name),
        isChatToolName(name) ? chatToolDigest(name).toString("hex") : undefined,
      );
    });
  }
}

interface StoredApproval {
  readonly subjectKey: string;
  readonly scopeKey: string;
  readonly toolName: string;
  readonly definitionDigest: Uint8Array;
  readonly expiresAt: Date | null;
  readonly updatedAt: Date;
}

function toApprovalRow(
  row: StoredApproval,
  destructive: boolean,
  available: boolean,
  currentDigest: string | undefined,
): ApprovalRow {
  const expiresAt = row.expiresAt ?? undefined;

  return {
    subjectKey: row.subjectKey,
    toolName: row.toolName,
    scope: row.scopeKey === GLOBAL_SCOPE ? "global" : "session",
    approvedAt: row.updatedAt,
    expiresAt,
    expired: expiresAt !== undefined && expiresAt.getTime() <= Date.now(),
    digest: Buffer.from(row.definitionDigest).toString("hex"),
    available,
    destructive,
    currentDigest,
  };
}
