import { isLoopbackHost, isPrivateAddress } from "../common/network-address.ts";
import type { DiscoveryFailure } from "./discovery-failure.ts";
import type { AuthorizationServerMetadata } from "./authorization-metadata.ts";

export interface EndpointPolicy {
  readonly allowLoopback: boolean;
}

const PUBLIC_ONLY: EndpointPolicy = { allowLoopback: false };

export interface AuthorizationServer {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string | undefined;
  readonly revocationEndpoint: string | undefined;
  readonly scopesSupported: readonly string[];
}

export type { DiscoveryFailure };

export type DiscoveryResult =
  | { readonly ok: true; readonly server: AuthorizationServer }
  | { readonly ok: false; readonly failure: DiscoveryFailure };

/**
 * Guard: https is required and a literal private address is refused outright.
 * The authorization code and then the access token travel over these urls, and
 * the server naming them is one this platform has not met.
 *
 * Guard: loopback is not a blanket exception but a policy the caller states.
 * It exists so a demo backend on this machine can be driven over plain http,
 * and a deployment that forwards a registrant's url must leave it off — a
 * process reaching its own loopback is reaching services no client can.
 *
 * @param raw the url to check
 * @param policy whether this caller accepts loopback; public-only by default
 * @returns whether a request may be made to it
 */
export function isSecureEndpoint(
  raw: string,
  policy: EndpointPolicy = PUBLIC_ONLY,
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (isLoopbackHost(url.hostname)) {
    return policy.allowLoopback;
  }

  return url.protocol === "https:" && !isPrivateAddress(url.hostname);
}

/**
 * Reads the metadata url a `401` pointed at.
 *
 * @param header the response's `WWW-Authenticate` value
 * @returns the url the server named, or `undefined` when it named none
 */
export function resourceMetadataUrlFrom(
  header: string | undefined,
): string | undefined {
  const found = header?.match(/resource_metadata="([^"]+)"/u);

  return found?.[1];
}

/**
 * The urls an authorization server's metadata may be published at, in the order
 * RFC 8414 and OpenID Discovery expect them to be tried.
 *
 * @param issuer the issuer the resource named
 * @returns candidate urls, most specific first
 */
export function authorizationServerMetadataUrls(
  issuer: string,
): readonly string[] {
  const url = new URL(issuer);
  const suffix = url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, "");
  const candidates = [
    `/.well-known/oauth-authorization-server${suffix}`,
    `/.well-known/openid-configuration${suffix}`,
  ];
  if (suffix !== "") {
    candidates.push(`${suffix}/.well-known/openid-configuration`);
  }

  return candidates.map((path) => new URL(path, url.origin).href);
}

function sameUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return false;
  }
}

/**
 * Checks an authorization server's own metadata before anything is sent to it.
 *
 * Guard: `issuer` must equal the url the document was fetched from. RFC 8414
 * requires the match because without it a resource can name any host, that host
 * can claim to be any issuer, and the authorization request lands somewhere the
 * user never agreed to.
 *
 * Guard: S256 is required rather than preferred. A server offering only `plain`
 * has no protection against an intercepted authorization code, and falling back
 * to it silently would be a downgrade this platform chose on the user's behalf.
 *
 * @param issuer the issuer url the resource metadata named
 * @param metadata the document fetched from that issuer
 * @returns the endpoints to use, or the reason the server was refused
 */
export function verifyAuthorizationServer(
  issuer: string,
  metadata: AuthorizationServerMetadata,
  policy: EndpointPolicy = PUBLIC_ONLY,
): DiscoveryResult {
  if (!sameUrl(metadata.issuer, issuer)) {
    return { ok: false, failure: "issuer_mismatch" };
  }

  const endpoints = [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.registration_endpoint,
    metadata.revocation_endpoint,
  ].filter((endpoint): endpoint is string => endpoint !== undefined);

  if (!endpoints.every((endpoint) => isSecureEndpoint(endpoint, policy))) {
    return { ok: false, failure: "insecure_transport" };
  }

  if (!(metadata.code_challenge_methods_supported ?? []).includes("S256")) {
    return { ok: false, failure: "pkce_unsupported" };
  }

  return {
    ok: true,
    server: {
      /**
       * Guard: the issuer is carried exactly as the document wrote it, never
       * through `new URL().href`. That normalization appends a trailing slash to
       * an issuer that has no path, and RFC 8414 makes the issuer an exact
       * string while RFC 9207 requires the `iss` a callback carries to be
       * identical to it. A normalized copy compares unequal to every `iss` such
       * a server sends, and the authorization is refused at the last step with
       * nothing in the message to say why.
       */
      issuer: metadata.issuer,
      authorizationEndpoint: metadata.authorization_endpoint,
      tokenEndpoint: metadata.token_endpoint,
      registrationEndpoint: metadata.registration_endpoint,
      revocationEndpoint: metadata.revocation_endpoint,
      scopesSupported: metadata.scopes_supported ?? [],
    },
  };
}
