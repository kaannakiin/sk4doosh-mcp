import type { IntegrationId } from "@chat/contracts/integration/integration";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";
import type { UserId } from "../db/ids.ts";
import { ConnectionRepository } from "./connection.repository.ts";
import { CredentialCipherService } from "./credential-cipher.service.ts";
import { IntegrationRepository } from "./integration.repository.ts";
import { IntegrationAuthorizationService } from "./integration-authorization.service.ts";
import { refreshTokens, type OauthTransport } from "./oauth-client.ts";

const TOKEN_TIMEOUT_MS = 10_000;

const MAX_TOKEN_BYTES = 64 * 1024;

/**
 * Guard: a token about to expire is refreshed rather than spent. The remote call
 * takes time, and one that started inside the last second of a token's life
 * arrives after it.
 */
const EXPIRY_MARGIN_MS = 60_000;

const LEASE_MS = 15_000;

const LEASE_WAIT_MS = 250;

const LEASE_ATTEMPTS = 8;

export type TokenOutcome =
  | { readonly kind: "ok"; readonly accessToken: string }
  | { readonly kind: "open" }
  | { readonly kind: "not_connected" }
  | { readonly kind: "reauth_required" }
  | { readonly kind: "provider_unavailable" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

@Injectable()
export class ConnectionTokenService {
  private readonly logger = new Logger(ConnectionTokenService.name);

  private readonly transport: OauthTransport;

  constructor(
    private readonly connections: ConnectionRepository,
    private readonly integrations: IntegrationRepository,
    private readonly authorization: IntegrationAuthorizationService,
    private readonly cipher: CredentialCipherService,
    @Inject(ConfigService) config: ConfigService<AppConfig, true>,
  ) {
    this.transport = {
      endpoint: {
        allowLoopback:
          config.get("environment", { infer: true }) !== "production",
      },
      timeoutMs: TOKEN_TIMEOUT_MS,
      maxBytes: MAX_TOKEN_BYTES,
    };
  }

  /**
   * The bearer token to present to an integration's MCP server, renewed if the
   * stored one is spent.
   *
   * @param userId the subject of the trusted session
   * @param integrationId the integration the call is aimed at
   * @returns the token, or why there is none to present
   */
  async accessTokenFor(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<TokenOutcome> {
    const integration = await this.integrations.loadVisible(
      userId,
      integrationId,
    );

    if (integration === undefined) {
      return { kind: "not_connected" };
    }

    /**
     * Guard: answered before the connection is even read, and without touching
     * the network. A server that asks for no credential has nothing to renew,
     * and running the refresh path against one would discover an authorization
     * server that does not exist and end by marking a working integration as
     * needing authorization again.
     */
    if (integration.authMode === "none") {
      return { kind: "open" };
    }

    const owner = BigInt(userId);
    const connection = await this.connections.loadSealed(owner, integration.id);

    if (connection === undefined) {
      return { kind: "not_connected" };
    }

    if (
      connection.status !== "active" ||
      connection.sealedAccessToken === undefined
    ) {
      return { kind: "reauth_required" };
    }

    if (!this.isSpent(connection.tokenExpiresAt)) {
      return this.unseal(connection.publicId, connection.sealedAccessToken);
    }

    return this.renew(owner, integration, connection.id);
  }

  private isSpent(expiresAt: Date | undefined): boolean {
    return (
      expiresAt !== undefined &&
      expiresAt.getTime() - EXPIRY_MARGIN_MS <= Date.now()
    );
  }

  private async unseal(
    publicId: string,
    sealed: string,
  ): Promise<TokenOutcome> {
    const token = await this.cipher.open(publicId, "access_token", sealed);

    return token === undefined
      ? { kind: "reauth_required" }
      : { kind: "ok", accessToken: token };
  }

  /**
   * Guard: a caller that loses the claim waits for the holder instead of
   * refreshing too. Spending one refresh token twice is answered by a rotating
   * authorization server with `invalid_grant`, and that answer is
   * indistinguishable from a grant the user actually revoked.
   */
  private async renew(
    owner: bigint,
    integration: {
      readonly id: bigint;
      readonly publicId: string;
      readonly mcpUrl: string;
    },
    connectionId: bigint,
  ): Promise<TokenOutcome> {
    if (!(await this.connections.takeRefreshLease(connectionId, LEASE_MS))) {
      return this.awaitHolder(owner, integration.id);
    }

    try {
      return await this.spendRefreshToken(owner, integration, connectionId);
    } catch (cause) {
      await this.connections.releaseRefreshLease(connectionId);

      throw cause;
    }
  }

  private async awaitHolder(
    owner: bigint,
    integrationId: bigint,
  ): Promise<TokenOutcome> {
    for (let attempt = 0; attempt < LEASE_ATTEMPTS; attempt += 1) {
      await sleep(LEASE_WAIT_MS);
      const row = await this.connections.loadSealed(owner, integrationId);

      if (row === undefined || row.sealedAccessToken === undefined) {
        return { kind: "reauth_required" };
      }

      if (row.status !== "active") {
        return { kind: "reauth_required" };
      }

      if (!this.isSpent(row.tokenExpiresAt)) {
        return this.unseal(row.publicId, row.sealedAccessToken);
      }
    }

    return { kind: "provider_unavailable" };
  }

  private async spendRefreshToken(
    owner: bigint,
    integration: {
      readonly id: bigint;
      readonly publicId: string;
      readonly mcpUrl: string;
    },
    connectionId: bigint,
  ): Promise<TokenOutcome> {
    const connection = await this.connections.loadSealed(owner, integration.id);
    if (
      connection === undefined ||
      connection.status !== "active" ||
      connection.sealedRefreshToken === undefined
    ) {
      await this.connections.releaseRefreshLease(connectionId);
      await this.connections.markReauthRequired(connectionId);

      return { kind: "reauth_required" };
    }

    /**
     * Guard: another caller may have refreshed while this one waited for the
     * claim, so the row is read again under it. Spending a refresh token that is
     * already superseded is the exact failure the claim exists to prevent.
     */
    if (!this.isSpent(connection.tokenExpiresAt)) {
      await this.connections.releaseRefreshLease(connectionId);

      return this.unseal(
        connection.publicId,
        connection.sealedAccessToken ?? "",
      );
    }

    const prepared = await this.authorization.ensureClient(integration);
    if (prepared.kind !== "ready") {
      await this.connections.releaseRefreshLease(connectionId);

      return { kind: "provider_unavailable" };
    }

    const credential = await this.authorization.credentialFor(
      integration.id,
      integration.publicId,
      prepared.server.issuer,
      prepared.clientId,
    );

    const refreshToken = await this.cipher.open(
      connection.publicId,
      "refresh_token",
      connection.sealedRefreshToken,
    );

    if (credential === undefined || refreshToken === undefined) {
      await this.connections.releaseRefreshLease(connectionId);

      return { kind: "reauth_required" };
    }

    const granted = await refreshTokens(
      {
        issuer: prepared.server.issuer,
        tokenEndpoint: prepared.server.tokenEndpoint,
        clientId: prepared.clientId,
        credential,
        refreshToken,
        resource: integration.mcpUrl,
      },
      this.transport,
    );

    /**
     * Guard: only the server's own refusal ends the connection. A transport
     * failure leaves the row exactly as it was — an outage at the provider is
     * not a reason to make everyone who uses it authorize again.
     */
    if (granted.kind === "failed") {
      await this.connections.releaseRefreshLease(connectionId);

      return { kind: "provider_unavailable" };
    }

    if (granted.kind === "rejected" || granted.tokens.tokenType !== "bearer") {
      this.logger.warn(
        `refresh refused for connection ${connection.publicId}: ${granted.kind === "rejected" ? granted.error : granted.tokens.tokenType}`,
      );
      await this.connections.markReauthRequired(connectionId);

      return { kind: "reauth_required" };
    }

    const { tokens } = granted;
    await this.connections.applyRefresh(connectionId, {
      sealedAccessToken: await this.cipher.seal(
        connection.publicId,
        "access_token",
        tokens.accessToken,
      ),
      sealedRefreshToken:
        tokens.refreshToken === undefined
          ? undefined
          : await this.cipher.seal(
              connection.publicId,
              "refresh_token",
              tokens.refreshToken,
            ),
      tokenExpiresAt:
        tokens.expiresIn === undefined
          ? undefined
          : new Date(Date.now() + tokens.expiresIn * 1000),
      providerScope: tokens.scope,
      keyVersion: this.cipher.keyVersion,
    });

    return { kind: "ok", accessToken: tokens.accessToken };
  }
}
