import { isUniqueConstraintError, type Prisma } from "@chat/db";
import type { RemoteTool } from "@chat/contracts/integration/remote-tool";
import type {
  IntegrationAuthMode,
  IntegrationId,
} from "@chat/contracts/integration/integration";
import type { IntegrationSummary } from "@chat/contracts/integration/registration";
import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import type { UserId } from "../db/ids.ts";
import { visibleToUser } from "./connection-rows.ts";

export interface IntegrationDraft {
  readonly ownerId: bigint;
  readonly mcpUrl: string;
  readonly displayName: string;
}

export interface IntegrationRecord {
  readonly id: bigint;
  readonly publicId: string;
  readonly mcpUrl: string;
  readonly authMode: IntegrationAuthMode;
}

export interface OpenIntegrationDraft extends IntegrationDraft {
  readonly tools: readonly RemoteTool[];
}

export interface OwnedIntegration {
  readonly record: IntegrationRecord;
  readonly inUse: boolean;
}

export type CreateResult = IntegrationRecord | "duplicate";

function toolRows(integrationId: bigint, tools: readonly RemoteTool[]) {
  return tools.map((tool) => ({
    integrationId,
    name: tool.name,
    title: tool.title ?? null,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema as Prisma.InputJsonObject,
  }));
}

@Injectable()
export class IntegrationRepository {
  constructor(private readonly db: DbService) {}

  /**
   * Records a server one person pointed the product at.
   *
   * Guard: the duplicate is decided by the unique index rather than by a read
   * before the write. Two adds of the same url arriving together both find
   * nothing and both insert, and the loser of that race would own a second
   * authorization row and a second dynamic client registration.
   *
   * @param input the owner, the url discovery will run against, and a label
   * @returns the created row, or `"duplicate"` when the owner already has it
   */
  async create(input: IntegrationDraft): Promise<CreateResult> {
    try {
      const row = await this.db.client.integration.create({
        data: {
          origin: "user",
          ownerId: input.ownerId,
          mcpUrl: input.mcpUrl,
          displayName: input.displayName,
        },
        select: { id: true, publicId: true, mcpUrl: true, authMode: true },
      });

      return row;
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        return "duplicate";
      }

      throw cause;
    }
  }

  /**
   * Records a server that asks for no credential, with its tools, in one write.
   *
   * Guard: a single transaction, which the authorization-code path cannot be.
   * There is nothing to negotiate with this server, so every remote call is over
   * before the first row is written — and either the integration, the connection
   * and the tools all exist or none of them do. The half-written row the oauth
   * path has to recover from cannot occur here.
   *
   * Guard: the connection is opened `active` carrying no token, which is what
   * `connection_token_state_check` accepts and what `authorizeInvocation` needs
   * to allow a `user` integration. There is no token to hold, so the row that
   * records "this person wired this server up" is the whole of the grant.
   *
   * @param input the owner, the url, a label, and the tools the server listed
   * @returns the created row, or `"duplicate"` when the owner already has it
   */
  async createOpen(input: OpenIntegrationDraft): Promise<CreateResult> {
    try {
      return await this.db.client.$transaction(async (tx) => {
        const row = await tx.integration.create({
          data: {
            origin: "user",
            authMode: "none",
            ownerId: input.ownerId,
            mcpUrl: input.mcpUrl,
            displayName: input.displayName,
          },
          select: { id: true, publicId: true, mcpUrl: true, authMode: true },
        });

        /**
         * Guard: `createdAt` is written from this clock rather than left to the
         * column default. The database runs on another host and the table
         * requires `authorized_at >= created_at`; a default taken from the
         * server's clock against an `authorizedAt` taken from this one turns any
         * skew in that direction into a rejected insert.
         */
        const now = new Date();
        const connection = await tx.connection.create({
          data: {
            userId: input.ownerId,
            integrationId: row.id,
            status: "active",
            createdAt: now,
            authorizedAt: now,
          },
          select: { id: true },
        });

        await tx.connectionEvent.create({
          data: { connectionId: connection.id, kind: "connected" },
        });

        if (input.tools.length > 0) {
          await tx.integrationTool.createMany({
            data: toolRows(row.id, input.tools),
          });
        }

        return row;
      });
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        return "duplicate";
      }

      throw cause;
    }
  }

  /**
   * The owner's own row at this url, and whether anyone is using it.
   *
   * Guard: `inUse` is answered rather than the row being hidden. A row with
   * connections must not be repaired by the retry path — that path deletes what
   * it cannot complete, and here it would take a working grant with it — but the
   * caller still has to know the row is there, so that it refuses the second add
   * without first going out to the network.
   *
   * @param userId the subject of the trusted session
   * @param mcpUrl the url, already normalized
   * @returns the row and its state, or `undefined` when the owner has none
   */
  async findOwnedByUrl(
    userId: UserId,
    mcpUrl: string,
  ): Promise<OwnedIntegration | undefined> {
    const row = await this.db.client.integration.findFirst({
      where: { origin: "user", ownerId: BigInt(userId), mcpUrl },
      select: {
        id: true,
        publicId: true,
        mcpUrl: true,
        authMode: true,
        _count: { select: { connections: true } },
      },
    });

    if (row === null) {
      return undefined;
    }

    const { _count, ...record } = row;

    return { record, inUse: _count.connections > 0 };
  }

  /**
   * Everything the owner's integrations page shows, in one read.
   *
   * @param userId the subject of the trusted session
   * @returns the visible integrations, oldest first
   */
  async listFor(userId: UserId): Promise<readonly IntegrationSummary[]> {
    const rows = await this.db.client.integration.findMany({
      where: visibleToUser(userId),
      include: {
        connections: { where: { userId: BigInt(userId) } },
        _count: { select: { tools: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => {
      const [connection] = row.connections;

      return {
        id: row.publicId,
        displayName: row.displayName,
        mcpUrl: row.mcpUrl,
        origin: row.origin,
        authMode: row.authMode,
        toolCount: row._count.tools,
        connection:
          connection === undefined
            ? null
            : {
                status: connection.status,
                authorizedAt: connection.authorizedAt?.toISOString() ?? null,
                lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
              },
      };
    });
  }

  /**
   * @param userId the subject of the trusted session
   * @param integrationId the integration the request named
   * @returns the row, or `undefined` when none is visible to this user
   */
  async loadVisible(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<IntegrationRecord | undefined> {
    const row = await this.db.client.integration.findFirst({
      where: visibleToUser(userId, integrationId),
      select: { id: true, publicId: true, mcpUrl: true, authMode: true },
    });

    return row ?? undefined;
  }

  /**
   * Guard: `deleteMany` gated on origin and owner, not `delete` by id. A partner
   * integration is offered to everyone and is not one reader's to remove, and a
   * `user` integration belongs to exactly one account.
   *
   * @param userId the subject of the trusted session
   * @param integrationId the integration the request named
   * @returns whether a row of this user's own was removed
   */
  async removeOwned(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<boolean> {
    const { count } = await this.db.client.integration.deleteMany({
      where: {
        publicId: integrationId,
        origin: "user",
        ownerId: BigInt(userId),
      },
    });

    return count === 1;
  }

  /**
   * Moves an open integration onto the authorization-code path.
   *
   * Guard: the mode and the connections move in one transaction. A connection
   * left `active` under an integration that now demands a token would authorize
   * an invocation with nothing to present, and `authorizeInvocation` reads only
   * the status.
   *
   * Guard: called only after a client has actually been registered. Flipping the
   * mode first and failing to register would leave an integration that can
   * neither be used openly nor authorized.
   *
   * @param integrationId the integration's surrogate key
   */
  async upgradeToOauth(integrationId: bigint): Promise<void> {
    await this.db.client.$transaction(async (tx) => {
      await tx.integration.update({
        where: { id: integrationId },
        data: { authMode: "oauth" },
      });

      const affected = await tx.connection.findMany({
        where: { integrationId, status: "active" },
        select: { id: true },
      });

      if (affected.length === 0) {
        return;
      }

      await tx.connection.updateMany({
        where: { integrationId, status: "active" },
        data: {
          status: "reauth_required",
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          tokenKeyVersion: null,
          refreshLeaseUntil: null,
        },
      });
      await tx.connectionEvent.createMany({
        data: affected.map(({ id }) => ({
          connectionId: id,
          kind: "reauth_required" as const,
        })),
      });
    });
  }

  /**
   * Replaces the recorded tool list with what the server just listed.
   *
   * Guard: the old rows are deleted in the same transaction. A tool the server
   * has withdrawn must not survive as a row the chat surface can still resolve,
   * and an upsert-only write would leave exactly that.
   *
   * @param integrationId the integration's surrogate key
   * @param tools the list as the server returned it
   */
  async replaceTools(
    integrationId: bigint,
    tools: readonly RemoteTool[],
  ): Promise<void> {
    await this.db.client.$transaction(async (tx) => {
      await tx.integrationTool.deleteMany({ where: { integrationId } });
      if (tools.length === 0) {
        return;
      }

      await tx.integrationTool.createMany({
        data: toolRows(integrationId, tools),
      });
    });
  }
}
