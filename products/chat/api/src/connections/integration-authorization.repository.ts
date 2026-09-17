import type { AuthorizationServer } from "@chat/contracts/integration/discovery";
import type { DiscoveryFailure } from "@chat/contracts/integration/discovery-failure";
import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import {
  isTokenEndpointAuthMethod,
  type TokenEndpointAuthMethod,
} from "./token-endpoint-auth.ts";

/**
 * Guard: the ciphertext columns are named `sealed*` here. They are strings like
 * any other, and a call site that reads one into a variable named
 * `clientSecret` is one refactor away from presenting it to a token endpoint.
 */
export interface StoredAuthorization {
  readonly server: AuthorizationServer;
  readonly metadataUrl: string;
  readonly clientId: string | undefined;
  readonly sealedClientSecret: string | undefined;
  readonly sealedRegistrationAccessToken: string | undefined;
  readonly registrationClientUri: string | undefined;
  readonly tokenEndpointAuthMethod: TokenEndpointAuthMethod | undefined;
  readonly registeredRedirectUri: string | undefined;
  readonly clientSecretExpiresAt: Date | undefined;
}

export interface DiscoverySave {
  readonly integrationId: bigint;
  readonly resource: string;
  readonly metadataUrl: string;
  readonly server: AuthorizationServer;
  readonly staleAfter: Date;
}

export interface StoredClient {
  readonly method: TokenEndpointAuthMethod;
  readonly sealedClientSecret: string | undefined;
}

export interface RegistrationSave {
  readonly integrationId: bigint;
  readonly issuer: string;
  readonly clientId: string;
  readonly sealedClientSecret: string | undefined;
  readonly sealedRegistrationAccessToken: string | undefined;
  readonly registrationClientUri: string | undefined;
  readonly tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  readonly registeredRedirectUri: string;
  readonly clientSecretExpiresAt: Date | undefined;
  readonly keyVersion: number;
}

/**
 * Guard: a `client_id` is issued by one authorization server and means nothing
 * at another, so re-identifying the server drops the whole registration. Every
 * column written by registration is listed, because the table's own constraint
 * refuses an issuer change that leaves any of them behind.
 */
const CLEARED_CLIENT = {
  clientIssuer: null,
  clientId: null,
  clientSecret: null,
  registrationAccessToken: null,
  registrationClientUri: null,
  keyVersion: null,
  clientSecretExpiresAt: null,
  registeredAt: null,
  tokenEndpointAuthMethod: null,
  registeredRedirectUri: null,
} as const;

const UNSEALED = {
  clientSecret: false,
  registrationAccessToken: false,
} as const;

function authMethodOf(
  value: string | null,
): TokenEndpointAuthMethod | undefined {
  return value !== null && isTokenEndpointAuthMethod(value) ? value : undefined;
}

@Injectable()
export class IntegrationAuthorizationRepository {
  constructor(private readonly db: DbService) {}

  /**
   * Reads the authorization row when it is still usable.
   *
   * Guard: `mcpUrl` is compared, not merely carried. Discovery ran against one
   * url and bound the resource metadata to it; a row that outlived an edit to
   * `Integration.mcpUrl` describes a different resource, and a token minted from
   * it is bound to the old one while being presented to the new.
   *
   * Guard: staleness is the query's business, not the caller's. A row past
   * `staleAfter` simply does not come back, so there is no path where a caller
   * forgets to check and uses endpoints a provider moved — or that someone
   * poisoned during a short window.
   *
   * @param integrationId the integration's surrogate key
   * @param mcpUrl the url discovery must have run against
   * @returns the row, with its credentials still sealed, or `undefined`
   */
  async loadFresh(
    integrationId: bigint,
    mcpUrl: string,
  ): Promise<StoredAuthorization | undefined> {
    const row = await this.db.client.integrationAuthorization.findFirst({
      where: {
        integrationId,
        resource: mcpUrl,
        staleAfter: { gt: new Date() },
      },
      omit: UNSEALED,
    });

    if (row === null) {
      return undefined;
    }

    return {
      server: {
        issuer: row.issuer,
        authorizationEndpoint: row.authorizationEndpoint,
        tokenEndpoint: row.tokenEndpoint,
        registrationEndpoint: row.registrationEndpoint ?? undefined,
        revocationEndpoint: row.revocationEndpoint ?? undefined,
        scopesSupported: row.scopesSupported,
      },
      metadataUrl: row.metadataUrl,
      clientId: row.clientId ?? undefined,
      sealedClientSecret: row.clientSecret ?? undefined,
      sealedRegistrationAccessToken: row.registrationAccessToken ?? undefined,
      registrationClientUri: row.registrationClientUri ?? undefined,
      tokenEndpointAuthMethod: authMethodOf(row.tokenEndpointAuthMethod),
      registeredRedirectUri: row.registeredRedirectUri ?? undefined,
      clientSecretExpiresAt: row.clientSecretExpiresAt ?? undefined,
    };
  }

  /**
   * Records what discovery found.
   *
   * Guard: an issuer change drives every active connection of that integration
   * to `reauth_required` in the same transaction that writes the new issuer. The
   * tokens those connections hold were minted by a server this integration no
   * longer points at; leaving them `active` presents them to the new one.
   *
   * @param input the resource, the well-known that answered, and the server
   * @returns whether the issuer changed
   */
  async saveDiscovery(input: DiscoverySave): Promise<boolean> {
    return this.db.client.$transaction(async (tx) => {
      const current = await tx.integrationAuthorization.findUnique({
        where: { integrationId: input.integrationId },
        select: { issuer: true },
      });

      const issuerChanged =
        current !== null && current.issuer !== input.server.issuer;

      /**
       * Guard: `discoveredAt` is written from this clock rather than left to the
       * column's default. The database runs on another host, and the table
       * requires `verified_at >= discovered_at` — a default taken from the
       * server's clock against a `verifiedAt` taken from this one turns any
       * skew in that direction into a rejected insert.
       */
      const now = new Date();
      const metadata = {
        resource: input.resource,
        metadataUrl: input.metadataUrl,
        issuer: input.server.issuer,
        authorizationEndpoint: input.server.authorizationEndpoint,
        tokenEndpoint: input.server.tokenEndpoint,
        registrationEndpoint: input.server.registrationEndpoint ?? null,
        revocationEndpoint: input.server.revocationEndpoint ?? null,
        scopesSupported: [...input.server.scopesSupported],
        verifiedAt: now,
        staleAfter: input.staleAfter,
        refreshFailedAt: null,
        refreshFailure: null,
      };

      await tx.integrationAuthorization.upsert({
        where: { integrationId: input.integrationId },
        create: {
          integrationId: input.integrationId,
          discoveredAt: now,
          ...metadata,
        },
        update: issuerChanged ? { ...metadata, ...CLEARED_CLIENT } : metadata,
      });

      if (!issuerChanged) {
        return false;
      }

      const affected = await tx.connection.findMany({
        where: { integrationId: input.integrationId, status: "active" },
        select: { id: true },
      });

      if (affected.length > 0) {
        await tx.connection.updateMany({
          where: { integrationId: input.integrationId, status: "active" },
          data: {
            status: "reauth_required",
            accessToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
            tokenKeyVersion: null,
          },
        });
        await tx.connectionEvent.createMany({
          data: affected.map(({ id }) => ({
            connectionId: id,
            kind: "reauth_required" as const,
          })),
        });
      }

      return true;
    });
  }

  /**
   * Attaches an issued client to the row discovery wrote.
   *
   * Guard: the write is gated on the issuer it was registered at and on the
   * client columns still being empty. A re-discovery that changed the issuer
   * while the registration request was in flight makes this a no-op instead of
   * attaching a client id to an authorization server that never issued it.
   *
   * @param input the issued client, its credentials already sealed
   * @returns whether the row was still the one that was registered against
   */
  async saveRegistration(input: RegistrationSave): Promise<boolean> {
    const sealed =
      input.sealedClientSecret !== undefined ||
      input.sealedRegistrationAccessToken !== undefined;

    const { count } = await this.db.client.integrationAuthorization.updateMany({
      where: {
        integrationId: input.integrationId,
        issuer: input.issuer,
        clientId: null,
      },
      data: {
        clientIssuer: input.issuer,
        clientId: input.clientId,
        clientSecret: input.sealedClientSecret ?? null,
        registrationAccessToken: input.sealedRegistrationAccessToken ?? null,
        registrationClientUri: input.registrationClientUri ?? null,
        tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
        registeredRedirectUri: input.registeredRedirectUri,
        clientSecretExpiresAt: input.clientSecretExpiresAt ?? null,
        keyVersion: sealed ? input.keyVersion : null,
        registeredAt: new Date(),
      },
    });

    return count === 1;
  }

  /**
   * Reads what a code exchange needs to authenticate at the token endpoint.
   *
   * Guard: gated on the issuer and the client id the attempt snapshotted. A
   * refresh that landed while the user was at the authorization server has
   * already cleared the client columns, and answering with whatever the row now
   * holds would present one server's client secret to another's endpoint.
   *
   * @param integrationId the integration the attempt named
   * @param issuer the issuer as the attempt snapshotted it
   * @param clientId the client id as the attempt snapshotted it
   * @returns the sealed secret and the method to use, or `undefined`
   */
  async loadClientFor(
    integrationId: bigint,
    issuer: string,
    clientId: string,
  ): Promise<StoredClient | undefined> {
    const row = await this.db.client.integrationAuthorization.findFirst({
      where: { integrationId, issuer, clientIssuer: issuer, clientId },
      omit: UNSEALED,
    });

    const method = authMethodOf(row?.tokenEndpointAuthMethod ?? null);
    if (row === null || method === undefined) {
      return undefined;
    }

    return { method, sealedClientSecret: row.clientSecret ?? undefined };
  }

  /**
   * Guard: `updateMany` so that an integration with no row yet is a no-op. A
   * failure to discover is not a reason to create a row that carries no
   * endpoints, and `update` would throw where there is nothing to record.
   *
   * @param integrationId the integration whose refresh failed
   * @param failure why it failed
   */
  async recordRefreshFailure(
    integrationId: bigint,
    failure: DiscoveryFailure,
  ): Promise<void> {
    await this.db.client.integrationAuthorization.updateMany({
      where: { integrationId },
      data: { refreshFailedAt: new Date(), refreshFailure: failure },
    });
  }
}
