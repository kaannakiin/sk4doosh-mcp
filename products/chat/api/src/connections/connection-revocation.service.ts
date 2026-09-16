import type { IntegrationId } from "@chat/contracts/integration/integration";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";
import type { UserId } from "../db/ids.ts";
import { ConnectionRepository } from "./connection.repository.ts";
import { CredentialCipherService } from "./credential-cipher.service.ts";
import { IntegrationRepository } from "./integration.repository.ts";
import { IntegrationAuthorizationRepository } from "./integration-authorization.repository.ts";
import { IntegrationAuthorizationService } from "./integration-authorization.service.ts";
import {
  revokeToken,
  type ClientCredential,
  type OauthTransport,
  type TokenHint,
} from "./oauth-client.ts";

const REVOKE_TIMEOUT_MS = 10_000;

const MAX_REVOKE_BYTES = 16 * 1024;

export type DisconnectOutcome = "disconnected" | "not_connected" | "unknown_integration";

@Injectable()
export class ConnectionRevocationService {
  private readonly logger = new Logger(ConnectionRevocationService.name);

  private readonly transport: OauthTransport;

  constructor(
    private readonly connections: ConnectionRepository,
    private readonly integrations: IntegrationRepository,
    private readonly clients: IntegrationAuthorizationRepository,
    private readonly authorization: IntegrationAuthorizationService,
    private readonly cipher: CredentialCipherService,
    @Inject(ConfigService) config: ConfigService<AppConfig, true>,
  ) {
    this.transport = {
      endpoint: {
        allowLoopback:
          config.get("environment", { infer: true }) !== "production",
      },
      timeoutMs: REVOKE_TIMEOUT_MS,
      maxBytes: MAX_REVOKE_BYTES,
    };
  }

  /**
   * Withdraws a connection, at the provider first and then here.
   *
   * Guard: the local row is cleared whether or not the provider accepted the
   * revocation. A reader who pressed disconnect must end up disconnected; the
   * remote call is what also stops the grant existing there, and it is not this
   * product's to guarantee.
   *
   * @param userId the subject of the trusted session
   * @param integrationId the integration to disconnect from
   * @returns whether there was a connection to withdraw
   */
  async disconnect(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<DisconnectOutcome> {
    const integration = await this.integrations.loadVisible(
      userId,
      integrationId,
    );

    if (integration === undefined) {
      return "unknown_integration";
    }

    const connection = await this.connections.loadSealed(
      BigInt(userId),
      integration.id,
    );

    if (connection === undefined) {
      return "not_connected";
    }

    await this.revokeRemotely(integration, connection);

    return (await this.connections.markRevoked(connection.id))
      ? "disconnected"
      : "not_connected";
  }

  /**
   * Guard: the refresh token is revoked first. It is the one that can mint more
   * access tokens, so a process that died between the two calls would otherwise
   * leave the renewable half of the grant alive.
   */
  private async revokeRemotely(
    integration: { readonly id: bigint; readonly publicId: string; readonly mcpUrl: string },
    connection: {
      readonly publicId: string;
      readonly sealedAccessToken: string | undefined;
      readonly sealedRefreshToken: string | undefined;
    },
  ): Promise<void> {
    const stored = await this.clients.loadFresh(
      integration.id,
      integration.mcpUrl,
    );

    const endpoint = stored?.server.revocationEndpoint;
    if (
      stored === undefined ||
      endpoint === undefined ||
      stored.clientId === undefined
    ) {
      return;
    }

    const credential = await this.authorization.credentialFor(
      integration.id,
      integration.publicId,
      stored.server.issuer,
      stored.clientId,
    );

    if (credential === undefined) {
      return;
    }

    for (const hint of ["refresh_token", "access_token"] as const) {
      const sealed =
        hint === "refresh_token"
          ? connection.sealedRefreshToken
          : connection.sealedAccessToken;

      if (sealed !== undefined) {
        await this.revokeOne(
          connection.publicId,
          { issuer: stored.server.issuer, endpoint, clientId: stored.clientId },
          credential,
          hint,
          sealed,
        );
      }
    }
  }

  private async revokeOne(
    connectionPublicId: string,
    server: {
      readonly issuer: string;
      readonly endpoint: string;
      readonly clientId: string;
    },
    credential: ClientCredential,
    hint: TokenHint,
    sealed: string,
  ): Promise<void> {
    const token = await this.cipher.open(connectionPublicId, hint, sealed);
    if (token === undefined) {
      return;
    }

    const accepted = await revokeToken(
      {
        issuer: server.issuer,
        revocationEndpoint: server.endpoint,
        clientId: server.clientId,
        credential,
        token,
        hint,
      },
      this.transport,
    );

    if (!accepted) {
      this.logger.warn(
        `the provider did not accept the ${hint} revocation for ${connectionPublicId}`,
      );
    }
  }
}
