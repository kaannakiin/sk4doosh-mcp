import type { ConnectionStatus } from "@chat/contracts/integration/connection-status";
import type {
  IntegrationAuthMode,
  IntegrationId,
  IntegrationOrigin,
} from "@chat/contracts/integration/integration";
import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import type { UserId } from "../db/ids.ts";
import {
  toInvocationContext,
  visibleToUser,
  type InvocationContext,
} from "./connection-rows.ts";

export interface ConnectableIntegration {
  readonly id: bigint;
  readonly publicId: string;
  readonly mcpUrl: string;
  readonly origin: IntegrationOrigin;
  readonly authMode: IntegrationAuthMode;
  readonly scopes: readonly string[];
}

/**
 * Guard: the token columns are named `sealed*` here for the same reason the
 * authorization row's are. They are strings like any other, and a call site that
 * reads one into a variable named `accessToken` is one refactor away from
 * presenting a ciphertext to an MCP server as a bearer token.
 */
export interface SealedConnection {
  readonly id: bigint;
  readonly publicId: string;
  readonly status: ConnectionStatus;
  readonly sealedAccessToken: string | undefined;
  readonly sealedRefreshToken: string | undefined;
  readonly tokenExpiresAt: Date | undefined;
}

export interface RefreshedTokens {
  readonly sealedAccessToken: string;
  readonly sealedRefreshToken: string | undefined;
  readonly tokenExpiresAt: Date | undefined;
  readonly providerScope: string | undefined;
  readonly keyVersion: number;
}

export interface AuthorizationGrant {
  readonly userId: bigint;
  readonly integrationId: bigint;
  readonly sealedAccessToken: string;
  readonly sealedRefreshToken: string | undefined;
  readonly tokenExpiresAt: Date | undefined;
  readonly providerScope: string | undefined;
  readonly keyVersion: number;
}

@Injectable()
export class ConnectionRepository {
  constructor(private readonly db: DbService) {}

  /**
   * Everything an invocation decision needs, in one read.
   *
   * Guard: a `user` origin integration belongs to one person, so the query
   * refuses to resolve someone else's by its public id. Without the filter a
   * caller naming an id they do not own would learn that the integration exists,
   * which is the whole of what a private server's registration discloses.
   *
   * Guard: the connection is selected by owner here rather than by an id the
   * caller supplies, so there is no identifier a caller could name to reach
   * another user's connection.
   *
   * @param userId the subject of the trusted session, never a value the model produced
   * @param integrationId the integration the requested tool was resolved from
   * @returns the decision input, or `undefined` when no integration is visible
   * to this user under that id
   */
  async loadInvocationContext(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<InvocationContext | undefined> {
    const owner = BigInt(userId);
    const found = await this.db.client.integration.findFirst({
      where: visibleToUser(userId, integrationId),
      include: {
        toolScopes: true,
        connections: { where: { userId: owner }, include: { scopes: true } },
      },
    });

    return found === null ? undefined : toInvocationContext(found);
  }

  /**
   * The integration a connect request names, as its owner may see it.
   *
   * Guard: the same visibility filter the invoke path uses. A caller naming a
   * `user` integration they do not own must not learn it exists, and starting an
   * authorization against it would disclose exactly that.
   *
   * @param userId the subject of the trusted session
   * @param integrationId the integration the request named
   * @returns what the connect flow needs, or `undefined` when none is visible
   */
  async loadConnectable(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<ConnectableIntegration | undefined> {
    const row = await this.db.client.integration.findFirst({
      where: visibleToUser(userId, integrationId),
      include: { toolScopes: { select: { scope: true } } },
    });

    if (row === null) {
      return undefined;
    }

    return {
      id: row.id,
      publicId: row.publicId,
      mcpUrl: row.mcpUrl,
      origin: row.origin,
      authMode: row.authMode,
      scopes: [...new Set(row.toolScopes.map(({ scope }) => scope))].sort(),
    };
  }

  /**
   * Reads one user's connection with its credentials unsealed to the caller.
   *
   * Guard: `GLOBAL_OMIT` hides both token columns from every query in the
   * process, and this is the one place that opens them. Anything else that needs
   * a token asks this repository for it rather than widening its own select.
   *
   * @param userId the connection's owner
   * @param integrationId the integration's surrogate key
   * @returns the row, credentials still sealed, or `undefined`
   */
  async loadSealed(
    userId: bigint,
    integrationId: bigint,
  ): Promise<SealedConnection | undefined> {
    const row = await this.db.client.connection.findUnique({
      where: { userId_integrationId: { userId, integrationId } },
      omit: { accessToken: false, refreshToken: false },
    });

    if (row === null) {
      return undefined;
    }

    return {
      id: row.id,
      publicId: row.publicId,
      status: row.status,
      sealedAccessToken: row.accessToken ?? undefined,
      sealedRefreshToken: row.refreshToken ?? undefined,
      tokenExpiresAt: row.tokenExpiresAt ?? undefined,
    };
  }

  /**
   * Claims the right to refresh this connection's token.
   *
   * Guard: a conditional update rather than a read followed by a write, so two
   * requests arriving together cannot both believe they hold the claim. An
   * authorization server that rotates refresh tokens answers the second spend of
   * one with `invalid_grant`, and reading that as "the user must authorize
   * again" throws a working connection away.
   *
   * Guard: the claim expires rather than being released on failure. A process
   * that dies mid-refresh would otherwise leave the connection unrefreshable for
   * as long as the row survives.
   *
   * @param connectionId the connection's surrogate key
   * @param leaseMs how long the claim is good for
   * @returns whether this caller holds it
   */
  async takeRefreshLease(
    connectionId: bigint,
    leaseMs: number,
  ): Promise<boolean> {
    const now = new Date();
    const { count } = await this.db.client.connection.updateMany({
      where: {
        id: connectionId,
        status: "active",
        OR: [
          { refreshLeaseUntil: null },
          { refreshLeaseUntil: { lt: now } },
        ],
      },
      data: { refreshLeaseUntil: new Date(now.getTime() + leaseMs) },
    });

    return count === 1;
  }

  /**
   * Writes the tokens a refresh returned and drops the claim.
   *
   * Guard: `sealedRefreshToken` is only written when the server returned a new
   * one. RFC 6749 does not require a refresh response to carry one, and writing
   * `null` over the stored token would make the next refresh impossible.
   *
   * @param connectionId the connection's surrogate key
   * @param tokens the sealed tokens and what the server granted
   */
  async applyRefresh(
    connectionId: bigint,
    tokens: RefreshedTokens,
  ): Promise<void> {
    await this.db.client.connection.update({
      where: { id: connectionId },
      data: {
        accessToken: tokens.sealedAccessToken,
        ...(tokens.sealedRefreshToken === undefined
          ? {}
          : { refreshToken: tokens.sealedRefreshToken }),
        tokenExpiresAt: tokens.tokenExpiresAt ?? null,
        tokenKeyVersion: tokens.keyVersion,
        ...(tokens.providerScope === undefined
          ? {}
          : { providerScope: tokens.providerScope }),
        refreshLeaseUntil: null,
      },
    });
  }

  /**
   * @param connectionId the connection's surrogate key
   */
  async releaseRefreshLease(connectionId: bigint): Promise<void> {
    await this.db.client.connection.update({
      where: { id: connectionId },
      data: { refreshLeaseUntil: null },
    });
  }

  /**
   * Guard: the status change, the token columns and the lease are cleared in one
   * statement. `connection_token_state_check` refuses a non-active row that
   * still carries a token, so a two-step version of this would be rejected by
   * Postgres between the steps.
   *
   * @param connectionId the connection's surrogate key
   */
  async markReauthRequired(connectionId: bigint): Promise<void> {
    await this.db.client.$transaction(async (tx) => {
      const { count } = await tx.connection.updateMany({
        where: { id: connectionId, status: "active" },
        data: {
          status: "reauth_required",
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          tokenKeyVersion: null,
          refreshLeaseUntil: null,
        },
      });

      if (count === 1) {
        await tx.connectionEvent.create({
          data: { connectionId, kind: "reauth_required" },
        });
      }
    });
  }

  /**
   * Guard: the same single statement, and `revokedAt` is set with the status
   * because `connection_revoked_status_check` requires the two to agree.
   *
   * @param connectionId the connection's surrogate key
   * @returns whether the row was still holding something to withdraw
   */
  async markRevoked(connectionId: bigint): Promise<boolean> {
    return this.db.client.$transaction(async (tx) => {
      const { count } = await tx.connection.updateMany({
        where: { id: connectionId, status: { not: "revoked" } },
        data: {
          status: "revoked",
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          tokenKeyVersion: null,
          refreshLeaseUntil: null,
          revokedAt: new Date(),
        },
      });

      if (count === 1) {
        await tx.connectionEvent.create({
          data: { connectionId, kind: "revoked" },
        });
      }

      return count === 1;
    });
  }

  /**
   * Opens or reopens the connection a successful exchange will fill in.
   *
   * Guard: the row is left `reauth_required` until the tokens are written. The
   * connection's public id is the credentials' encryption binding, so it has to
   * exist before they can be sealed — and a row that stayed `active` through
   * that window would authorize an invocation that has no token to present.
   *
   * @param userId the connection's owner
   * @param integrationId the integration being connected
   * @returns the public id to bind the credentials to, and whether it is new
   */
  async beginAuthorization(
    userId: bigint,
    integrationId: bigint,
  ): Promise<{ readonly publicId: string; readonly existed: boolean }> {
    return this.db.client.$transaction(async (tx) => {
      const current = await tx.connection.findUnique({
        where: { userId_integrationId: { userId, integrationId } },
        select: { id: true },
      });

      /**
       * Guard: `createdAt` comes from this clock, not the column default. The
       * database runs on another host and the table requires
       * `authorized_at >= created_at`; `completeAuthorization` writes
       * `authorizedAt` from this process moments later, and a default taken from
       * the server's clock turns any skew in that direction into a row that can
       * never be completed.
       */
      const row = await tx.connection.upsert({
        where: { userId_integrationId: { userId, integrationId } },
        create: {
          userId,
          integrationId,
          status: "reauth_required",
          createdAt: new Date(),
        },
        update: {
          status: "reauth_required",
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          tokenKeyVersion: null,
          revokedAt: null,
        },
        select: { publicId: true },
      });

      return { publicId: row.publicId, existed: current !== null };
    });
  }

  /**
   * Writes the sealed tokens and makes the connection usable.
   *
   * @param grant the sealed tokens and what the authorization server granted
   * @param existed whether this connection had been authorized before
   */
  async completeAuthorization(
    grant: AuthorizationGrant,
    existed: boolean,
  ): Promise<void> {
    await this.db.client.$transaction(async (tx) => {
      const row = await tx.connection.update({
        where: {
          userId_integrationId: {
            userId: grant.userId,
            integrationId: grant.integrationId,
          },
        },
        data: {
          status: "active",
          accessToken: grant.sealedAccessToken,
          refreshToken: grant.sealedRefreshToken ?? null,
          tokenExpiresAt: grant.tokenExpiresAt ?? null,
          tokenKeyVersion: grant.keyVersion,
          providerScope: grant.providerScope ?? null,
          authorizedAt: new Date(),
          revokedAt: null,
        },
        select: { id: true },
      });

      await tx.connectionEvent.create({
        data: {
          connectionId: row.id,
          kind: existed ? "reconnected" : "connected",
        },
      });
    });
  }
}
