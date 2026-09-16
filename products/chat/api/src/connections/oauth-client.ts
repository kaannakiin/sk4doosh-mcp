import type { EndpointPolicy } from "@chat/contracts/integration/discovery";
import * as oauth from "oauth4webapi";

import {
  BlockedAddressError,
  guardedOauthFetch,
  TransportError,
} from "./oauth-fetch.ts";

export type { AuthorizationServer, ResourceServer } from "oauth4webapi";

/**
 * Re-exported rather than imported at the call site: `oauth-client.ts` is the
 * one file allowed to name the library, so that no other module can reach a
 * function whose transport this one does not bind.
 */
export {
  calculatePKCECodeChallenge,
  generateRandomCodeVerifier,
  generateRandomState,
} from "oauth4webapi";

export type RegisteredClientMetadata = oauth.OmitSymbolProperties<oauth.Client>;

export interface OauthTransport {
  readonly endpoint: EndpointPolicy;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export type MetadataFailure =
  | "blocked_address"
  | "unreachable"
  | "malformed"
  | "identity_mismatch";

export type MetadataOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "failed"; readonly failure: MetadataFailure };

export type RegistrationResponse =
  | { readonly kind: "ok"; readonly client: RegisteredClientMetadata }
  | { readonly kind: "rejected"; readonly error: string }
  | { readonly kind: "failed"; readonly failure: MetadataFailure };

const JSON_HEADERS = { accept: "application/json" };

/**
 * Guard: plain http is permitted exactly where loopback is, and nowhere else.
 * The library refuses it outright; the in-repo demo backend serves it, and the
 * same policy flag that lets this platform resolve loopback is what lets it
 * speak http to one.
 */
function insecureAllowed(transport: OauthTransport): boolean {
  return transport.endpoint.allowLoopback;
}

function classify(cause: unknown): MetadataFailure {
  if (cause instanceof BlockedAddressError) {
    return "blocked_address";
  }

  if (cause instanceof TransportError) {
    return "unreachable";
  }

  if (cause instanceof oauth.OperationProcessingError) {
    /**
     * Guard: an unexpected status is reported as unreachable, not malformed.
     * The authorization server metadata is tried at three candidate urls and
     * the first two normally answer `404`; treating that as a malformed
     * document would abandon the search at the candidate that was never
     * expected to answer.
     */
    if (cause.code === oauth.RESPONSE_IS_NOT_CONFORM) {
      return "unreachable";
    }

    if (cause.code === oauth.JSON_ATTRIBUTE_COMPARISON) {
      return "identity_mismatch";
    }
  }

  return "malformed";
}

/**
 * Guard: metadata reads follow redirects, credential-bearing requests do not.
 * A `302` answered to a token or registration request replays the client secret
 * to whatever host the response named; a metadata document has nothing to leak.
 */
function readJson(transport: OauthTransport, url: string): Promise<Response> {
  return guardedOauthFetch({ ...transport, followRedirects: true })(url, {
    method: "GET",
    headers: JSON_HEADERS,
    body: undefined,
  });
}

/**
 * Reads the protected resource metadata for an MCP endpoint.
 *
 * @param mcpUrl the resource identifier the document must claim
 * @param metadataUrl the url a `401` named, when it named one
 * @param transport address policy, deadline and body ceiling
 * @returns the document, or why it was refused
 */
export async function readResourceMetadata(
  mcpUrl: string,
  metadataUrl: string | undefined,
  transport: OauthTransport,
): Promise<MetadataOutcome<oauth.ResourceServer>> {
  try {
    const response =
      metadataUrl === undefined
        ? await oauth.resourceDiscoveryRequest(new URL(mcpUrl), {
            [oauth.customFetch]: guardedOauthFetch({
              ...transport,
              followRedirects: true,
            }),
            [oauth.allowInsecureRequests]: insecureAllowed(transport),
          })
        : await readJson(transport, metadataUrl);

    return {
      kind: "ok",
      value: await oauth.processResourceDiscoveryResponse(
        new URL(mcpUrl),
        response,
      ),
    };
  } catch (cause) {
    return { kind: "failed", failure: classify(cause) };
  }
}

/**
 * Reads one authorization server metadata candidate.
 *
 * Guard: the candidate urls are built in `@chat/contracts` rather than by
 * `discoveryRequest`, which produces one url per call and offers only the
 * OIDC-append and OAuth-prepend forms. MCP also expects the OIDC-prepend form,
 * and a server publishing only there would be reported unreachable.
 *
 * @param issuer the issuer the resource named, which the document must claim
 * @param metadataUrl the candidate to read
 * @param transport address policy, deadline and body ceiling
 * @returns the document, or why it was refused
 */
export async function readAuthorizationServerMetadata(
  issuer: string,
  metadataUrl: string,
  transport: OauthTransport,
): Promise<MetadataOutcome<oauth.AuthorizationServer>> {
  try {
    const response = await readJson(transport, metadataUrl);

    return {
      kind: "ok",
      value: await oauth.processDiscoveryResponse(new URL(issuer), response),
    };
  } catch (cause) {
    return { kind: "failed", failure: classify(cause) };
  }
}

/**
 * Registers this platform as a client at an authorization server it has not met.
 *
 * @param as the verified authorization server metadata
 * @param metadata the client metadata to register
 * @param transport address policy, deadline and body ceiling
 * @returns the issued client, the server's own refusal, or a transport failure
 */
export async function registerClient(
  as: oauth.AuthorizationServer,
  metadata: Partial<RegisteredClientMetadata>,
  transport: OauthTransport,
): Promise<RegistrationResponse> {
  try {
    const response = await oauth.dynamicClientRegistrationRequest(
      as,
      metadata,
      {
        [oauth.customFetch]: guardedOauthFetch({
          ...transport,
          followRedirects: false,
        }),
        [oauth.allowInsecureRequests]: insecureAllowed(transport),
      },
    );

    return {
      kind: "ok",
      client: await oauth.processDynamicClientRegistrationResponse(response),
    };
  } catch (cause) {
    if (cause instanceof oauth.ResponseBodyError) {
      return { kind: "rejected", error: cause.error };
    }

    return { kind: "failed", failure: classify(cause) };
  }
}

/**
 * Guard: a confidential method carries its secret in the same value. The
 * database refuses a row whose method and secret disagree, and the union keeps
 * that invariant in the type — there is no branch here that has to invent an
 * empty secret to satisfy the signature.
 */
export type ClientCredential =
  | { readonly method: "none" }
  | {
      readonly method: "client_secret_basic" | "client_secret_post";
      readonly secret: string;
    };

export interface CallbackParameters {
  readonly code: string;
  readonly state: string;
  readonly iss: string | undefined;
}

export interface CodeExchange {
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly credential: ClientCredential;
  readonly callback: CallbackParameters;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly resource: string;
}

export interface GrantedTokens {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly refreshToken: string | undefined;
  readonly expiresIn: number | undefined;
  readonly scope: string | undefined;
}

export type GrantOutcome =
  | { readonly kind: "ok"; readonly tokens: GrantedTokens }
  | { readonly kind: "rejected"; readonly error: string }
  | { readonly kind: "failed"; readonly failure: MetadataFailure };

/**
 * The ceiling `connection_provider_scope_check` enforces on what a provider may
 * write into this platform's record of a grant.
 */
const MAX_SCOPE_LENGTH = 8192;

/**
 * Guard: what the server granted is recorded, and recording it can never fail
 * the grant. Nothing reads this value to decide anything — it is bookkeeping —
 * so a blank scope, surrounding space, or a list longer than the column accepts
 * all become "not recorded" rather than a constraint violation on the write that
 * completes an authorization the user already consented to.
 *
 * RFC 6749 puts no bound on `scope`, and a provider asked for broad access
 * answers with every scope it granted in one list.
 */
function scopeOf(scope: string | undefined): string | undefined {
  const trimmed = scope?.trim();

  return trimmed === undefined ||
    trimmed === "" ||
    trimmed.length > MAX_SCOPE_LENGTH
    ? undefined
    : trimmed;
}

function clientAuthFor(credential: ClientCredential): oauth.ClientAuth {
  switch (credential.method) {
    case "none":
      return oauth.None();

    case "client_secret_basic":
      return oauth.ClientSecretBasic(credential.secret);

    case "client_secret_post":
      return oauth.ClientSecretPost(credential.secret);
  }
}

/**
 * Exchanges an authorization code for tokens.
 *
 * Guard: the issuer and the token endpoint come from the caller, which read them
 * off the attempt row written when the browser was sent away. Reading them from
 * the integration's current row would let a refresh that landed while the user
 * was at the authorization server redirect the code and the client secret.
 *
 * Guard: `resource` is sent with the request. RFC 8707 is what makes the issued
 * token bound to this MCP server rather than usable at every resource the
 * authorization server covers.
 *
 * @param exchange the snapshot, the callback parameters and the verifier
 * @param transport address policy, deadline and body ceiling
 * @returns the tokens, the server's own refusal, or a transport failure
 */
export async function exchangeCode(
  exchange: CodeExchange,
  transport: OauthTransport,
): Promise<GrantOutcome> {
  const as = {
    issuer: exchange.issuer,
    token_endpoint: exchange.tokenEndpoint,
  };
  const client = { client_id: exchange.clientId };

  try {
    /**
     * Guard: the library refuses callback parameters it did not validate itself.
     * `validateAuthResponse` is what brands them, and on the way it repeats the
     * `state` comparison and the RFC 9207 `iss` check against the snapshot.
     */
    const parameters = oauth.validateAuthResponse(
      as,
      client,
      new URLSearchParams(
        exchange.callback.iss === undefined
          ? { code: exchange.callback.code, state: exchange.callback.state }
          : {
              code: exchange.callback.code,
              state: exchange.callback.state,
              iss: exchange.callback.iss,
            },
      ),
      exchange.callback.state,
    );

    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      clientAuthFor(exchange.credential),
      parameters,
      exchange.redirectUri,
      exchange.codeVerifier,
      {
        [oauth.customFetch]: guardedOauthFetch({
          ...transport,
          followRedirects: false,
        }),
        [oauth.allowInsecureRequests]: insecureAllowed(transport),
        additionalParameters: { resource: exchange.resource },
      },
    );

    const tokens = await oauth.processAuthorizationCodeResponse(
      as,
      client,
      response,
    );

    return {
      kind: "ok",
      tokens: {
        accessToken: tokens.access_token,
        tokenType: tokens.token_type,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: scopeOf(tokens.scope),
      },
    };
  } catch (cause) {
    if (cause instanceof oauth.ResponseBodyError) {
      return { kind: "rejected", error: cause.error };
    }

    return { kind: "failed", failure: classify(cause) };
  }
}

export interface TokenRefresh {
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly credential: ClientCredential;
  readonly refreshToken: string;
  readonly resource: string;
}

/**
 * Exchanges a refresh token for a new access token.
 *
 * Guard: `resource` is sent again. RFC 8707 binds the issued token to one
 * resource, and a refresh that omitted it would ask for whatever the grant
 * covers — widening the token past the MCP server the user consented to on every
 * renewal, silently, for as long as the connection lives.
 *
 * @param refresh the snapshot the connection stores and the token to spend
 * @param transport address policy, deadline and body ceiling
 * @returns the tokens, the server's own refusal, or a transport failure
 */
export async function refreshTokens(
  refresh: TokenRefresh,
  transport: OauthTransport,
): Promise<GrantOutcome> {
  const as = {
    issuer: refresh.issuer,
    token_endpoint: refresh.tokenEndpoint,
  };
  const client = { client_id: refresh.clientId };

  try {
    const response = await oauth.refreshTokenGrantRequest(
      as,
      client,
      clientAuthFor(refresh.credential),
      refresh.refreshToken,
      {
        [oauth.customFetch]: guardedOauthFetch({
          ...transport,
          followRedirects: false,
        }),
        [oauth.allowInsecureRequests]: insecureAllowed(transport),
        additionalParameters: { resource: refresh.resource },
      },
    );

    const tokens = await oauth.processRefreshTokenResponse(
      as,
      client,
      response,
    );

    return {
      kind: "ok",
      tokens: {
        accessToken: tokens.access_token,
        tokenType: tokens.token_type,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: scopeOf(tokens.scope),
      },
    };
  } catch (cause) {
    if (cause instanceof oauth.ResponseBodyError) {
      return { kind: "rejected", error: cause.error };
    }

    return { kind: "failed", failure: classify(cause) };
  }
}

export type TokenHint = "access_token" | "refresh_token";

export interface TokenRevocation {
  readonly issuer: string;
  readonly revocationEndpoint: string;
  readonly clientId: string;
  readonly credential: ClientCredential;
  readonly token: string;
  readonly hint: TokenHint;
}

/**
 * Asks the authorization server to invalidate one token.
 *
 * Guard: RFC 7009 answers `200` for a token it does not recognise, so a success
 * here is not proof the grant is gone. The caller clears its own copy either
 * way; this is the part that reaches the server, not the part that makes the
 * connection unusable.
 *
 * @param revocation the endpoint, the client to authenticate as, and the token
 * @param transport address policy, deadline and body ceiling
 * @returns whether the server accepted the revocation
 */
export async function revokeToken(
  revocation: TokenRevocation,
  transport: OauthTransport,
): Promise<boolean> {
  const as = {
    issuer: revocation.issuer,
    revocation_endpoint: revocation.revocationEndpoint,
  };

  try {
    const response = await oauth.revocationRequest(
      as,
      { client_id: revocation.clientId },
      clientAuthFor(revocation.credential),
      revocation.token,
      {
        [oauth.customFetch]: guardedOauthFetch({
          ...transport,
          followRedirects: false,
        }),
        [oauth.allowInsecureRequests]: insecureAllowed(transport),
        additionalParameters: { token_type_hint: revocation.hint },
      },
    );

    await oauth.processRevocationResponse(response);

    return true;
  } catch {
    return false;
  }
}
