import type { IntegrationAuthMode } from "@chat/contracts/integration/integration";
import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import type { UserId } from "../db/ids.ts";
import { visibleToUser } from "./connection-rows.ts";

export interface CatalogTool {
  readonly integrationId: bigint;
  readonly integrationPublicId: string;
  readonly integrationName: string;
  readonly mcpUrl: string;
  readonly authMode: IntegrationAuthMode;
  readonly remoteName: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly inputSchema: unknown;
  readonly destructive: boolean;
  readonly definitionDigest: string;
  readonly scoped: boolean;
}

export interface StaleIntegration {
  readonly id: bigint;
  readonly publicId: string;
  readonly mcpUrl: string;
  readonly authMode: IntegrationAuthMode;
  readonly neverRead: boolean;
}

@Injectable()
export class IntegrationToolRepository {
  constructor(private readonly db: DbService) {}

  /**
   * Every tool the reader's connected servers currently offer.
   *
   * Guard: only `active` connections are joined, so a revoked or reauth-pending
   * integration contributes nothing. `authorizeInvocation` would refuse each of
   * its tools anyway, and a model shown a tool it can never run learns to retry
   * rather than to explain.
   *
   * Guard: `scoped` answers whether a partner tool has a scope row. A partner
   * tool with none is permanently unmapped at invoke time, and the caller drops
   * it rather than offering a call that cannot succeed.
   *
   * @param userId the subject of the trusted session
   * @returns the catalog, ordered so a listing is stable between turns
   */
  async catalogFor(userId: UserId): Promise<readonly CatalogTool[]> {
    const owner = BigInt(userId);
    const rows = await this.db.client.integration.findMany({
      where: {
        ...visibleToUser(userId),
        connections: { some: { userId: owner, status: "active" } },
      },
      select: {
        id: true,
        publicId: true,
        displayName: true,
        mcpUrl: true,
        origin: true,
        authMode: true,
        tools: true,
        toolScopes: { select: { toolName: true } },
      },
      orderBy: { id: "asc" },
    });

    return rows.flatMap((row) => {
      const scopedNames = new Set(
        row.toolScopes.map(({ toolName }) => toolName),
      );

      return row.tools.map((tool) => ({
        integrationId: row.id,
        integrationPublicId: row.publicId,
        integrationName: row.displayName,
        mcpUrl: row.mcpUrl,
        authMode: row.authMode,
        remoteName: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        destructive: tool.destructive,
        definitionDigest: Buffer.from(tool.definitionDigest).toString("hex"),
        scoped: row.origin === "user" || scopedNames.has(tool.name),
      }));
    });
  }

  /**
   * The reader's integrations whose tool list is older than the ceiling.
   *
   * @param userId the subject of the trusted session
   * @param staleAfterMs how old a list may be before it is re-read
   * @returns the integrations to refresh, saying which have never been read
   */
  async staleFor(
    userId: UserId,
    staleAfterMs: number,
  ): Promise<readonly StaleIntegration[]> {
    const owner = BigInt(userId);
    const cutoff = new Date(Date.now() - staleAfterMs);
    const rows = await this.db.client.integration.findMany({
      where: {
        ...visibleToUser(userId),
        connections: { some: { userId: owner, status: "active" } },
        OR: [{ toolsRefreshedAt: null }, { toolsRefreshedAt: { lt: cutoff } }],
      },
      select: {
        id: true,
        publicId: true,
        mcpUrl: true,
        authMode: true,
        toolsRefreshedAt: true,
      },
    });

    return rows.map(({ toolsRefreshedAt, ...row }) => ({
      ...row,
      neverRead: toolsRefreshedAt === null,
    }));
  }

  /**
   * Claims the right to re-read one integration's tool list.
   *
   * Guard: one conditional update, and the loser does not wait. The token lease
   * has to make its loser wait because a caller without a token has nothing to
   * present; a caller with a stale tool list has a usable one, so waiting on
   * someone else's network call would be latency bought for nothing.
   *
   * Guard: the staleness test is part of the same statement. Reading it first
   * and claiming after would let two turns that both read "stale" both claim.
   *
   * @param integrationId the integration's surrogate key
   * @param staleAfterMs how old a list may be before it is re-read
   * @param leaseMs how long the claim is held
   * @returns whether this caller owns the refresh
   */
  async claimRefresh(
    integrationId: bigint,
    staleAfterMs: number,
    leaseMs: number,
  ): Promise<boolean> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - staleAfterMs);
    const { count } = await this.db.client.integration.updateMany({
      where: {
        id: integrationId,
        OR: [{ toolsRefreshedAt: null }, { toolsRefreshedAt: { lt: cutoff } }],
        AND: [
          {
            OR: [
              { toolsRefreshLeaseUntil: null },
              { toolsRefreshLeaseUntil: { lt: now } },
            ],
          },
        ],
      },
      data: { toolsRefreshLeaseUntil: new Date(now.getTime() + leaseMs) },
    });

    return count === 1;
  }

  /**
   * Guard: a failed read consumes the window as surely as a successful one —
   * `replaceTools` stamps the clock when a list arrives, and this stamps it when
   * none did. Leaving it untouched on failure would turn a provider outage into
   * a health check that runs on every turn, against a server already struggling.
   *
   * Guard: written from this clock rather than the database's, the same way
   * `createdAt` is in `createOpen` — the two hosts do not share one.
   *
   * @param integrationId the integration's surrogate key
   * @param failed whether the read ended without a list
   */
  async settleRefresh(integrationId: bigint, failed: boolean): Promise<void> {
    const now = new Date();
    await this.db.client.integration.update({
      where: { id: integrationId },
      data: {
        toolsRefreshLeaseUntil: null,
        ...(failed ? { toolsRefreshedAt: now, toolsRefreshFailedAt: now } : {}),
      },
    });
  }
}
