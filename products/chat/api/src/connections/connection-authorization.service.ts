import type {
  ConnectCallbackQuery,
  ConnectionOutcome,
} from "@chat/contracts/integration/connect";
import { isSecureEndpoint } from "@chat/contracts/integration/discovery";
import type { IntegrationId } from "@chat/contracts/integration/integration";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sha256Bytes } from "../common/utils/crypto.utils.ts";
import type { AppConfig } from "../config/configuration.ts";
import type { UserId } from "../db/ids.ts";
import { ConnectionAttemptRepository } from "./connection-attempt.repository.ts";
import { IntegrationRepository } from "./integration.repository.ts";
import { listTools } from "./remote-mcp.client.ts";
import { ConnectionRepository } from "./connection.repository.ts";
import { CredentialCipherService } from "./credential-cipher.service.ts";
import { IntegrationAuthorizationService } from "./integration-authorization.service.ts";
import {
  calculatePKCECodeChallenge,
  exchangeCode,
  generateRandomCodeVerifier,
  generateRandomState,
  type OauthTransport,
} from "./oauth-client.ts";

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

const TOKEN_TIMEOUT_MS = 10_000;

const MAX_TOKEN_BYTES = 64 * 1024;

/**
 * Guard: `toolScopes` describes a partner's published manifest and is empty for
 * a server the reader added, so that path reads the scopes the resource metadata
 * advertised instead. Sending no scope at all is what an authorization server
 * that requires one refuses, with an error the reader sees only after leaving.
 */
function scopeFor(
  integration: { readonly origin: string; readonly scopes: readonly string[] },
  advertised: readonly string[],
): string | undefined {
  const scopes = integration.origin === "partner" ? integration.scopes : advertised;

  return scopes.length === 0 ? undefined : scopes.join(" ");
}

export type StartOutcome =
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "refused"; readonly outcome: ConnectionOutcome };

@Injectable()
export class ConnectionAuthorizationService {
  private readonly logger = new Logger(ConnectionAuthorizationService.name);

  private readonly transport: OauthTransport;

  constructor(
    private readonly authorization: IntegrationAuthorizationService,
    private readonly attempts: ConnectionAttemptRepository,
    private readonly connections: ConnectionRepository,
    private readonly integrations: IntegrationRepository,
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
   * Builds the url the owner's browser is sent to, and records what it was sent
   * with.
   *
   * Guard: the attempt stores `issuer` and `tokenEndpoint` as they are now, and
   * the callback exchanges against those values. A refresh can rewrite the
   * integration's authorization row while the user is still at the server, and a
   * callback that read the current row would send the authorization code and the
   * client secret wherever the refresh had just pointed.
   *
   * Guard: the state is stored as a digest and the verifier as a ciphertext.
   * Nothing reads the state back — it is only compared — while the verifier has
   * to be replayed to the token endpoint.
   *
   * @param userId the subject of the trusted session
   * @param integrationId the integration the owner asked to connect
   * @returns the authorization url, or what to tell the browser instead
   */
  async start(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<StartOutcome> {
    const integration = await this.connections.loadConnectable(
      userId,
      integrationId,
    );

    if (integration === undefined) {
      return { kind: "refused", outcome: "integration_unavailable" };
    }

    /**
     * Guard: a server that asks for no credential has no authorization server to
     * send the reader to. The page offers no button for one, so arriving here is
     * a defect rather than a choice — and running discovery against it would end
     * by sending the browser to an endpoint this platform invented.
     */
    if (integration.authMode === "none") {
      return { kind: "refused", outcome: "integration_unavailable" };
    }

    const prepared = await this.authorization.ensureClient(integration);
    if (prepared.kind !== "ready") {
      this.logger.warn(
        `no client for integration ${integration.publicId}: ${prepared.kind === "refused" ? prepared.failure : prepared.reason}`,
      );

      return { kind: "refused", outcome: "provider_unavailable" };
    }

    const state = generateRandomState();
    const verifier = generateRandomCodeVerifier();
    const challenge = await calculatePKCECodeChallenge(verifier);
    const stateHash = sha256Bytes(state);
    const scope = scopeFor(integration, prepared.server.scopesSupported);

    await this.attempts.open({
      userId: BigInt(userId),
      integrationId: integration.id,
      stateHash,
      sealedCodeVerifier: await this.cipher.seal(
        stateHash.toString("hex"),
        "code_verifier",
        verifier,
      ),
      keyVersion: this.cipher.keyVersion,
      issuer: prepared.server.issuer,
      tokenEndpoint: prepared.server.tokenEndpoint,
      clientId: prepared.clientId,
      redirectUri: prepared.redirectUri,
      resource: integration.mcpUrl,
      scope,
      expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
    });

    const url = new URL(prepared.server.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", prepared.clientId);
    url.searchParams.set("redirect_uri", prepared.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("resource", integration.mcpUrl);
    if (scope !== undefined) {
      url.searchParams.set("scope", scope);
    }

    return { kind: "redirect", url: url.href };
  }

  /**
   * Turns the callback into a usable connection.
   *
   * Guard: the attempt is claimed before anything else happens, and claiming it
   * is what proves the state is genuine, unexpired and unused. An authorization
   * code is visible in browser history and in a referrer, so a second callback
   * carrying the same code finds nothing to exchange it against.
   *
   * Guard: the session's own user is compared against the attempt's. The state
   * already binds the two, but a state that leaked would otherwise let whoever
   * holds it finish someone else's connection into their own account.
   *
   * @param query the parameters the authorization server sent back
   * @param sessionUserId the subject of the session that arrived with it
   * @returns what to tell the browser
   */
  async complete(
    query: ConnectCallbackQuery,
    sessionUserId: UserId,
  ): Promise<ConnectionOutcome> {
    if (query.error !== undefined) {
      return "access_denied";
    }

    const stateHash = sha256Bytes(query.state);
    const attempt = await this.attempts.consume(stateHash);

    if (
      query.code === undefined ||
      attempt === undefined ||
      attempt.userId !== BigInt(sessionUserId)
    ) {
      this.logger.warn(
        `refusing a callback: ${query.code === undefined ? "it carried no code" : attempt === undefined ? "no open attempt matched its state" : "the attempt belongs to another session"}`,
      );

      return "attempt_invalid";
    }

    /**
     * Guard: RFC 9207 lets the server name itself in the callback, and a value
     * that disagrees with the snapshot is a mix-up — a code minted by one
     * authorization server about to be presented to another's token endpoint.
     */
    if (query.iss !== undefined && query.iss !== attempt.issuer) {
      this.logger.warn(
        `refusing a callback: it named issuer ${query.iss} while the attempt snapshotted ${attempt.issuer}`,
      );

      return "attempt_invalid";
    }

    if (!isSecureEndpoint(attempt.tokenEndpoint, this.transport.endpoint)) {
      return "provider_unavailable";
    }

    const verifier = await this.cipher.open(
      stateHash.toString("hex"),
      "code_verifier",
      attempt.sealedCodeVerifier,
    );

    const credential = await this.authorization.credentialFor(
      attempt.integrationId,
      attempt.integrationPublicId,
      attempt.issuer,
      attempt.clientId,
    );
    if (verifier === undefined || credential === undefined) {
      this.logger.warn(
        `cannot exchange for ${attempt.integrationPublicId}: ${verifier === undefined ? "the code verifier did not open" : "no usable client credential for the snapshotted issuer"}`,
      );

      return "connection_failed";
    }

    const granted = await exchangeCode(
      {
        issuer: attempt.issuer,
        tokenEndpoint: attempt.tokenEndpoint,
        clientId: attempt.clientId,
        credential,
        callback: { code: query.code, state: query.state, iss: query.iss },
        redirectUri: attempt.redirectUri,
        codeVerifier: verifier,
        resource: attempt.resource,
      },
      this.transport,
    );

    if (granted.kind === "rejected") {
      this.logger.warn(`the token endpoint refused: ${granted.error}`);

      return "connection_failed";
    }

    if (granted.kind === "failed") {
      return "provider_unavailable";
    }

    /**
     * Guard: only a bearer token is stored. A `dpop` token is bound to a key
     * this platform never generated, so presenting it would fail at the resource
     * with nothing here to explain why.
     */
    if (granted.tokens.tokenType !== "bearer") {
      this.logger.warn(`unsupported token type ${granted.tokens.tokenType}`);

      return "connection_failed";
    }

    await this.store(attempt.userId, attempt.integrationId, granted.tokens);
    await this.recordToolsSafely(
      attempt.integrationId,
      attempt.resource,
      granted.tokens.accessToken,
    );

    return "connected";
  }

  /**
   * Guard: nothing this does can undo the authorization. The token was granted
   * and sealed before it ran, so an empty tool list is a page that shows nothing
   * — while a throw reaching the controller would turn a connection that exists
   * into `connection_failed` on the reader's screen.
   */
  private async recordToolsSafely(
    integrationId: bigint,
    mcpUrl: string,
    accessToken: string,
  ): Promise<void> {
    try {
      await this.recordTools(integrationId, mcpUrl, accessToken);
    } catch (cause) {
      this.logger.error(
        `stored the connection but could not record its tools: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  private async recordTools(
    integrationId: bigint,
    mcpUrl: string,
    accessToken: string,
  ): Promise<void> {
    const listed = await listTools({
      url: mcpUrl,
      accessToken,
      endpoint: this.transport.endpoint,
      timeoutMs: this.transport.timeoutMs,
      maxBytes: this.transport.maxBytes,
    });

    if (listed.kind === "failed") {
      this.logger.warn(`could not list tools at ${mcpUrl}: ${listed.failure}`);

      return;
    }

    await this.integrations.replaceTools(integrationId, listed.value);
  }

  private async store(
    userId: bigint,
    integrationId: bigint,
    tokens: {
      readonly accessToken: string;
      readonly refreshToken: string | undefined;
      readonly expiresIn: number | undefined;
      readonly scope: string | undefined;
    },
  ): Promise<void> {
    const { publicId, existed } = await this.connections.beginAuthorization(
      userId,
      integrationId,
    );

    await this.connections.completeAuthorization(
      {
        userId,
        integrationId,
        sealedAccessToken: await this.cipher.seal(
          publicId,
          "access_token",
          tokens.accessToken,
        ),
        sealedRefreshToken:
          tokens.refreshToken === undefined
            ? undefined
            : await this.cipher.seal(
                publicId,
                "refresh_token",
                tokens.refreshToken,
              ),
        tokenExpiresAt:
          tokens.expiresIn === undefined
            ? undefined
            : new Date(Date.now() + tokens.expiresIn * 1000),
        providerScope: tokens.scope,
        keyVersion: this.cipher.keyVersion,
      },
      existed,
    );
  }
}
