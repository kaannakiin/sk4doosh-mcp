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
}
