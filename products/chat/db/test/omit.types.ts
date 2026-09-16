import type { Db } from "../src/client.ts";

export async function assertSensitiveFieldsAreOmitted(db: Db): Promise<void> {
  const password = await db.userPasswordCredential.findFirst();
  if (password !== null) {
    // @ts-expect-error Global omit must hide the password hash.
    void password.passwordHash;
  }

  const refresh = await db.authRefreshToken.findFirst();
  if (refresh !== null) {
    // @ts-expect-error Global omit must hide the refresh-token hash.
    void refresh.tokenHash;
  }

  const challenge = await db.authChallenge.findFirst();
  if (challenge !== null) {
    // @ts-expect-error Global omit must hide the challenge secret hash.
    void challenge.secretHash;
  }

  const authorization = await db.integrationAuthorization.findFirst();
  if (authorization !== null) {
    // @ts-expect-error Global omit must hide the encrypted client secret.
    void authorization.clientSecret;
    // @ts-expect-error Global omit must hide the encrypted registration token.
    void authorization.registrationAccessToken;
    void authorization.clientId;
  }

  const connection = await db.connection.findFirst();
  if (connection !== null) {
    // @ts-expect-error Global omit must hide the encrypted access token.
    void connection.accessToken;
    // @ts-expect-error Global omit must hide the encrypted refresh token.
    void connection.refreshToken;
    void connection.tokenExpiresAt;
  }

  const attempt = await db.connectionAttempt.findFirst();
  if (attempt !== null) {
    // @ts-expect-error Global omit must hide the state digest.
    void attempt.stateHash;
    // @ts-expect-error Global omit must hide the encrypted code verifier.
    void attempt.codeVerifier;
    void attempt.issuer;
  }
}
