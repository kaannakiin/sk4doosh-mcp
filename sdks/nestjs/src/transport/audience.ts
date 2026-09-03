import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";

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
        throw new InvalidTokenError("audience mismatch");
      }
      return authInfo;
    },
  };
}
