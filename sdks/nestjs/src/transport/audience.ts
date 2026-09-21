import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/express";

function normalize(url: URL): string {
  return url.toString().replace(/\/$/, "");
}

export function withAudienceCheck(
  inner: OAuthTokenVerifier,
  resource: URL,
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      const authInfo = await inner.verifyAccessToken(token);
      if (
        authInfo.resource === undefined ||
        normalize(authInfo.resource) !== normalize(resource)
      ) {
        /**
         * Guard: the express middleware recognises only the v2 `OAuthError`; a legacy error class
         * escapes as a 500 and the client never sees the `invalid_token` challenge that tells it to
         * re-authorize.
         */
        throw new OAuthError(OAuthErrorCode.InvalidToken, "audience mismatch");
      }
      return authInfo;
    },
  };
}
