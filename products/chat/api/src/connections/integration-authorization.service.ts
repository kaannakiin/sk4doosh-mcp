import type { AuthorizationServer } from "@chat/contracts/integration/discovery";
import type { DiscoveryFailure } from "@chat/contracts/integration/discovery-failure";
import { Injectable } from "@nestjs/common";

import { AuthorizationDiscoveryService } from "./authorization-discovery.service.ts";
import {
  ClientRegistrationService,
  type RegisteredClient,
} from "./client-registration.service.ts";
import { CredentialCipherService } from "./credential-cipher.service.ts";
import {
  IntegrationAuthorizationRepository,
  type StoredAuthorization,
} from "./integration-authorization.repository.ts";
import type { ClientCredential } from "./oauth-client.ts";
import type { TokenEndpointAuthMethod } from "./token-endpoint-auth.ts";

const AUTHORIZATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface AuthorizationSubject {
  readonly id: bigint;
  readonly publicId: string;
  readonly mcpUrl: string;
}

export type NoClientReason =
  | "registration_unsupported"
  | "registration_rejected"
  | "registration_unusable"
  | "registration_raced"
  | "redirect_uri_changed"
  | "client_secret_expired";

export type AuthorizationOutcome =
  | {
      readonly kind: "ready";
      readonly server: AuthorizationServer;
      readonly clientId: string;
      readonly tokenEndpointAuthMethod: TokenEndpointAuthMethod;
      readonly redirectUri: string;
    }
  | {
      readonly kind: "no_client";
      readonly server: AuthorizationServer;
      readonly reason: NoClientReason;
      readonly detail: string;
    }
  | { readonly kind: "refused"; readonly failure: DiscoveryFailure };

@Injectable()
export class IntegrationAuthorizationService {
  constructor(
    private readonly discovery: AuthorizationDiscoveryService,
    private readonly registration: ClientRegistrationService,
    private readonly repository: IntegrationAuthorizationRepository,
    private readonly cipher: CredentialCipherService,
  ) {}

  /**
   * Makes sure an integration has an authorization server and a client at it.
   *
   * Guard: a stored client is reused only while the registration it came from
   * still describes this deployment. A redirect uri that has moved, or a secret
   * that has expired, is a client the authorization server will refuse — and the
   * refusal arrives at the user's browser, naming neither value.
   *
   * @param integration the integration to prepare
   * @returns the client to authorize with, why none could be issued, or why the
   * server was refused outright
   */
  async ensureClient(
    integration: AuthorizationSubject,
  ): Promise<AuthorizationOutcome> {
    const stored = await this.repository.loadFresh(
      integration.id,
      integration.mcpUrl,
    );

    if (stored?.clientId !== undefined) {
      return this.reuse(stored, stored.clientId);
    }

    const discovered = await this.discovery.discover(integration.mcpUrl);
    if (!discovered.ok) {
      await this.repository.recordRefreshFailure(
        integration.id,
        discovered.failure,
      );

      return { kind: "refused", failure: discovered.failure };
    }

    await this.repository.saveDiscovery({
      integrationId: integration.id,
      resource: integration.mcpUrl,
      metadataUrl: discovered.metadataUrl,
      server: discovered.server,
      staleAfter: new Date(Date.now() + AUTHORIZATION_TTL_MS),
    });

    const outcome = await this.registration.register(
      discovered.server,
      discovered.resourceScopes,
    );

    switch (outcome.kind) {
      case "refused":
        return { kind: "refused", failure: outcome.failure };

      case "unsupported":
        return {
          kind: "no_client",
          server: discovered.server,
          reason: "registration_unsupported",
          detail: "the authorization server publishes no registration endpoint",
        };

      case "rejected":
        return {
          kind: "no_client",
          server: discovered.server,
          reason: "registration_rejected",
          detail: outcome.error,
        };

      case "unusable":
        return {
          kind: "no_client",
          server: discovered.server,
          reason: "registration_unusable",
          detail: outcome.reason,
        };

      case "registered":
        return this.store(integration, discovered.server, outcome.client);
    }
  }

  /**
   * Resolves what a request to the token or revocation endpoint authenticates
   * with.
   *
   * Guard: gated on the issuer and the client id the caller snapshotted, not on
   * whatever the row now holds. A re-discovery that moved the issuer has already
   * cleared the client columns, so the query returns nothing rather than
   * presenting one authorization server's client secret to another's endpoint.
   *
   * @param integrationId the integration's surrogate key
   * @param integrationPublicId the value the secret was sealed under
   * @param issuer the issuer as it was snapshotted
   * @param clientId the client id as it was snapshotted
   * @returns the credential, or `undefined` when the row no longer matches
   */
  async credentialFor(
    integrationId: bigint,
    integrationPublicId: string,
    issuer: string,
    clientId: string,
  ): Promise<ClientCredential | undefined> {
    const client = await this.repository.loadClientFor(
      integrationId,
      issuer,
      clientId,
    );

    if (client === undefined) {
      return undefined;
    }

    if (client.method === "none") {
      return { method: "none" };
    }

    if (client.sealedClientSecret === undefined) {
      return undefined;
    }

    const secret = await this.cipher.open(
      integrationPublicId,
      "client_secret",
      client.sealedClientSecret,
    );

    return secret === undefined ? undefined : { method: client.method, secret };
  }

  private reuse(
    stored: StoredAuthorization,
    clientId: string,
  ): AuthorizationOutcome {
    if (stored.registeredRedirectUri !== this.registration.redirectUri) {
      return {
        kind: "no_client",
        server: stored.server,
        reason: "redirect_uri_changed",
        detail: `registered ${stored.registeredRedirectUri ?? "nothing"}, this deployment answers at ${this.registration.redirectUri}`,
      };
    }

    if (
      stored.clientSecretExpiresAt !== undefined &&
      stored.clientSecretExpiresAt.getTime() <= Date.now()
    ) {
      return {
        kind: "no_client",
        server: stored.server,
        reason: "client_secret_expired",
        detail: `the client secret expired at ${stored.clientSecretExpiresAt.toISOString()}`,
      };
    }

    if (stored.tokenEndpointAuthMethod === undefined) {
      return {
        kind: "no_client",
        server: stored.server,
        reason: "registration_unusable",
        detail: "the stored row names no token endpoint authentication method",
      };
    }

    return {
      kind: "ready",
      server: stored.server,
      clientId,
      tokenEndpointAuthMethod: stored.tokenEndpointAuthMethod,
      redirectUri: this.registration.redirectUri,
    };
  }

  /**
   * Guard: both credentials are sealed before the repository is called, so the
   * only shape that can reach the table is a compact JWE — which is also what
   * the column's constraint accepts. A write path that forgot to encrypt is
   * refused by Postgres rather than stored in the clear.
   */
  private async store(
    integration: AuthorizationSubject,
    server: AuthorizationServer,
    client: RegisteredClient,
  ): Promise<AuthorizationOutcome> {
    const sealedClientSecret =
      client.clientSecret === undefined
        ? undefined
        : await this.cipher.seal(
            integration.publicId,
            "client_secret",
            client.clientSecret,
          );

    const sealedRegistrationAccessToken =
      client.registrationAccessToken === undefined
        ? undefined
        : await this.cipher.seal(
            integration.publicId,
            "registration_access_token",
            client.registrationAccessToken,
          );

    const attached = await this.repository.saveRegistration({
      integrationId: integration.id,
      issuer: server.issuer,
      clientId: client.clientId,
      sealedClientSecret,
      sealedRegistrationAccessToken,
      registrationClientUri: client.registrationClientUri,
      tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
      registeredRedirectUri: client.redirectUri,
      clientSecretExpiresAt: client.clientSecretExpiresAt,
      keyVersion: this.cipher.keyVersion,
    });

    return attached
      ? {
          kind: "ready",
          server,
          clientId: client.clientId,
          tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
          redirectUri: client.redirectUri,
        }
      : {
          kind: "no_client",
          server,
          reason: "registration_raced",
          detail:
            "the authorization row changed while the registration was in flight",
        };
  }
}
