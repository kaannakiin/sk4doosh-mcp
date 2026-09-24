import type { SessionId } from "@chat/contracts/chat/session";
import type {
  GrantScope,
  GrantTtl,
} from "@chat/contracts/integration/grant-scope";
import { grantExpiryFor } from "@chat/contracts/integration/grant-scope";
import type { IntegrationId } from "@chat/contracts/integration/integration";
import type {
  IntegrationApprovalMode,
  IntegrationApprovalSetting,
  ToolApprovalMode,
  ToolOverrideSetting,
} from "@chat/contracts/integration/tool-approval-mode";
import type {
  ToolGrant,
  ToolOverride,
} from "@chat/contracts/tools/approval-decision";
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

/**
 * Everything the gate needs to decide one turn, read in one go.
 */
export interface ApprovalContext {
  readonly mode: ToolApprovalMode;
  readonly integrationModes: ReadonlyMap<
    IntegrationId,
    IntegrationApprovalMode
  >;
  readonly overrides: ReadonlyMap<string, ToolOverride>;
  readonly grants: ReadonlyMap<string, readonly ToolGrant[]>;
}

export interface IntegrationToolRow {
  readonly name: string;
  readonly title: string | null;
  readonly destructive: boolean;
  readonly override: ToolOverrideSetting;
  readonly overrideStale: boolean;
}

interface OverrideSubject {
  readonly subjectKey: string;
  readonly integrationId: bigint | null;
  readonly toolName: string;
  readonly digest: Uint8Array<ArrayBuffer>;
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

  /**
   * The reader's mode, their per-integration modes, their per-tool overrides
   * and the grants that could apply to this turn.
   *
   * @param userId the subject of the trusted session
   * @param session the conversation this turn belongs to
   */
  async contextFor(
    userId: UserId,
    session: SessionId,
  ): Promise<ApprovalContext> {
    const owner = BigInt(userId);
    const [mode, settings, overrides, grants] = await Promise.all([
      this.modeFor(userId),
      this.db.client.integrationApprovalSetting.findMany({
        where: { userId: owner },
        select: { mode: true, integration: { select: { publicId: true } } },
      }),
      this.db.client.toolApprovalOverride.findMany({
        where: { userId: owner },
        select: { subjectKey: true, mode: true, definitionDigest: true },
      }),
      this.grantsFor(userId, session),
    ]);

    return {
      mode,
      integrationModes: new Map(
        settings.map((row) => [row.integration.publicId, row.mode]),
      ),
      overrides: new Map(
        overrides.map((row) => [
          row.subjectKey,
          {
            mode: row.mode,
            digest:
              row.definitionDigest === null
                ? undefined
                : Buffer.from(row.definitionDigest).toString("hex"),
          },
        ]),
      ),
      grants,
    };
  }

  /**
   * The key a grant of this scope is stored under.
   *
   * Guard: the conversation is read back off the reader's own `chat_session`
   * row, never taken from the body. A session id the reader does not own would
   * otherwise be accepted as a scope, and the lowercase form the scope check
   * requires comes from the uuid column rather than from whatever the client
   * sent.
   *
   * @returns the scope key, or `undefined` when the conversation is not the reader's
   */
  async scopeKeyFor(
    userId: UserId,
    scope: GrantScope,
    session: SessionId | undefined,
  ): Promise<string | undefined> {
    if (scope === "global") {
      return GLOBAL_SCOPE;
    }

    if (session === undefined) {
      return undefined;
    }

    const row = await this.db.client.chatSession.findFirst({
      where: { publicId: session, userId: BigInt(userId), deletedAt: null },
      select: { publicId: true },
    });

    return row?.publicId;
  }

  /**
   * @returns whether the integration is one this reader can see
   */
  async setIntegrationMode(
    userId: UserId,
    integrationId: IntegrationId,
    setting: IntegrationApprovalSetting,
  ): Promise<boolean> {
    const integration = await this.db.client.integration.findFirst({
      where: visibleToUser(userId, integrationId),
      select: { id: true },
    });

    if (integration === null) {
      return false;
    }

    const owner = BigInt(userId);
    if (setting === "inherit") {
      await this.db.client.integrationApprovalSetting.deleteMany({
        where: { userId: owner, integrationId: integration.id },
      });

      return true;
    }

    await this.db.client.integrationApprovalSetting.upsert({
      where: {
        userId_integrationId: { userId: owner, integrationId: integration.id },
      },
      create: { userId: owner, integrationId: integration.id, mode: setting },
      update: { mode: setting },
    });

    return true;
  }

  async overrideChatTool(
    userId: UserId,
    toolName: ChatToolName,
    setting: ToolOverrideSetting,
  ): Promise<void> {
    await this.writeOverride(
      userId,
      {
        subjectKey: toolName,
        integrationId: null,
        toolName,
        digest: Uint8Array.from(chatToolDigest(toolName)),
      },
      setting,
    );
  }

  /**
   * Guard: the digest an `auto` override is bound to is read from the tool row
   * here, never taken from the caller — the same rule `remember` follows, for
   * the same reason.
   *
   * @returns whether the tool was there to be overridden
   */
  async overrideRemote(
    userId: UserId,
    integrationId: IntegrationId,
    toolName: string,
    setting: ToolOverrideSetting,
  ): Promise<boolean> {
    const integration = await this.db.client.integration.findFirst({
      where: visibleToUser(userId, integrationId),
      select: { id: true, tools: { where: { name: toolName } } },
    });

    const [tool] = integration?.tools ?? [];
    if (integration === null || tool === undefined) {
      return false;
    }

    await this.writeOverride(
      userId,
      {
        subjectKey: approvalKey(integrationId, toolName),
        integrationId: integration.id,
        toolName,
        digest: Uint8Array.from(tool.definitionDigest),
      },
      setting,
    );

    return true;
  }

  private async writeOverride(
    userId: UserId,
    subject: OverrideSubject,
    setting: ToolOverrideSetting,
  ): Promise<void> {
    const owner = BigInt(userId);
    if (setting === "inherit") {
      await this.db.client.toolApprovalOverride.deleteMany({
        where: { userId: owner, subjectKey: subject.subjectKey },
      });

      return;
    }

    const digest = setting === "auto" ? subject.digest : null;
    await this.db.client.toolApprovalOverride.upsert({
      where: {
        userId_subjectKey: { userId: owner, subjectKey: subject.subjectKey },
      },
      create: {
        userId: owner,
        subjectKey: subject.subjectKey,
        integrationId: subject.integrationId,
        toolName: subject.toolName,
        mode: setting,
        definitionDigest: digest,
      },
      update: { mode: setting, definitionDigest: digest },
    });
  }

  /**
   * Every tool an integration offers, with the reader's override for each.
   *
   * @returns the tools, or `undefined` when no such integration is visible
   */
  async toolsFor(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<readonly IntegrationToolRow[] | undefined> {
    const integration = await this.db.client.integration.findFirst({
      where: visibleToUser(userId, integrationId),
      select: {
        id: true,
        tools: {
          select: {
            name: true,
            title: true,
            destructive: true,
            definitionDigest: true,
          },
          orderBy: { name: "asc" },
        },
      },
    });

    if (integration === null) {
      return undefined;
    }

    const overrides = await this.db.client.toolApprovalOverride.findMany({
      where: { userId: BigInt(userId), integrationId: integration.id },
      select: { toolName: true, mode: true, definitionDigest: true },
    });
    const byName = new Map(overrides.map((row) => [row.toolName, row]));

    return integration.tools.map((tool) => {
      const override = byName.get(tool.name);

      return {
        name: tool.name,
        title: tool.title,
        destructive: tool.destructive,
        override: override?.mode ?? "inherit",
        overrideStale:
          override?.mode === "auto" &&
          (override.definitionDigest === null ||
            !Buffer.from(override.definitionDigest).equals(
              Buffer.from(tool.definitionDigest),
            )),
      };
    });
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
   * @param ttl how long the grant lives, or the reader's preference when absent
   */
  async rememberChatTool(
    userId: UserId,
    toolName: ChatToolName,
    scopeKey: string,
    ttl?: GrantTtl,
  ): Promise<void> {
    const digest = Uint8Array.from(chatToolDigest(toolName));
    const expiresAt = grantExpiryFor(
      ttl ?? (await this.ttlFor(userId)),
      new Date(),
    );

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
   * @param ttl how long the grant lives, or the reader's preference when absent
   * @returns whether the tool was there to be remembered
   */
  async remember(
    userId: UserId,
    integrationId: IntegrationId,
    toolName: string,
    scopeKey: string,
    ttl?: GrantTtl,
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
    const expiresAt = grantExpiryFor(
      ttl ?? (await this.ttlFor(userId)),
      new Date(),
    );

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

      return toApprovalRow(
        row,
        live?.destructive ?? false,
        live !== undefined,
        live?.digest,
      );
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
