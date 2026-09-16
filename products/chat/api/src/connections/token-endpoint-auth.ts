/**
 * How this platform authenticates at a token endpoint.
 *
 * Guard: the three methods this platform can actually perform. RFC 7591 lets a
 * server register a method other than the one requested, and a row carrying
 * `private_key_jwt` would be a registration no connection could ever use. The
 * column's own constraint refuses the same set, so a value that reaches the
 * table is one this process can act on.
 */
export type TokenEndpointAuthMethod =
  | "client_secret_basic"
  | "client_secret_post"
  | "none";

const SUPPORTED: Record<TokenEndpointAuthMethod, true> = {
  client_secret_basic: true,
  client_secret_post: true,
  none: true,
};

export const DEFAULT_AUTH_METHOD: TokenEndpointAuthMethod =
  "client_secret_basic";

export function isTokenEndpointAuthMethod(
  value: string,
): value is TokenEndpointAuthMethod {
  return Object.hasOwn(SUPPORTED, value);
}
