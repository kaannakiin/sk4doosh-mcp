import type { IntegrationId } from "@chat/contracts/integration/integration";
import type { ToolApprovalMode } from "@chat/contracts/integration/tool-approval-mode";
import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import type { UserId } from "../db/ids.ts";
import { visibleToUser } from "./connection-rows.ts";

export interface RememberedApproval {
  readonly toolName: string;
  readonly approvedAt: Date;
  readonly digest: string;
}

export interface ApprovalRow extends RememberedApproval {
  readonly available: boolean;
  readonly destructive: boolean;
  readonly currentDigest: string | undefined;
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
   * Every digest this reader has remembered, indexed for one turn's lookups.
   *
   * Guard: read once per turn rather than per tool call. The approval callback
   * runs inside the model loop, and a database round trip there would sit
   * between the model choosing a tool and the reader being asked about it.
   *
   * @param userId the subject of the trusted session
   * @returns the remembered digest for each integration and tool
   */
  async digestsFor(userId: UserId): Promise<ReadonlyMap<string, string>> {
    const rows = await this.db.client.toolApproval.findMany({
      where: { userId: BigInt(userId) },
      select: {
        toolName: true,
        definitionDigest: true,
        integration: { select: { publicId: true } },
      },
    });

    return new Map(
      rows.map((row) => [
        approvalKey(row.integration.publicId, row.toolName),
        Buffer.from(row.definitionDigest).toString("hex"),
      ]),
    );
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
   * @param userId the subject of the trusted session
   * @param integrationId the integration the tool belongs to
   * @param toolName the tool as the remote server names it
   * @returns whether the tool was there to be remembered
   */
  async remember(
    userId: UserId,
    integrationId: IntegrationId,
    toolName: string,
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
    await this.db.client.toolApproval.upsert({
      where: {
        userId_integrationId_toolName: {
          userId: BigInt(userId),
          integrationId: integration.id,
          toolName,
        },
      },
      create: {
        userId: BigInt(userId),
        integrationId: integration.id,
        toolName,
        definitionDigest: digest,
      },
      update: { definitionDigest: digest },
    });

    return true;
  }

  /**
   * @param userId the subject of the trusted session
   * @param integrationId the integration the tool belongs to
   * @param toolName the tool as the remote server names it
   * @returns whether an approval was there to remove
   */
  async forget(
    userId: UserId,
    integrationId: IntegrationId,
    toolName: string,
  ): Promise<boolean> {
    const { count } = await this.db.client.toolApproval.deleteMany({
      where: {
        userId: BigInt(userId),
        toolName,
        integration: visibleToUser(userId, integrationId),
      },
    });

    return count === 1;
  }

  /**
   * What the reader has remembered for one integration, and whether each grant
   * is still live.
   *
   * Guard: a tool the server has withdrawn is reported, not swept. Approvals are
   * permanent by decision, and a server that answers with an empty list during
   * an outage must not be able to erase consent — so the join answers
   * `available` instead of a reaper deleting rows.
   *
   * @param userId the subject of the trusted session
   * @param integrationId the integration to list
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

      return {
        toolName: row.toolName,
        approvedAt: row.updatedAt,
        digest: Buffer.from(row.definitionDigest).toString("hex"),
        available: live !== undefined,
        destructive: live?.destructive ?? false,
        currentDigest: live?.digest,
      };
    });
  }
}
