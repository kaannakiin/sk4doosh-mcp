import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "./generated/client.js";

const GLOBAL_OMIT = {
  userPasswordCredential: { passwordHash: true },
  authRefreshToken: { tokenHash: true },
  authChallenge: { secretHash: true },
  integrationAuthorization: {
    clientSecret: true,
    registrationAccessToken: true,
  },
  connection: { accessToken: true, refreshToken: true },
  connectionAttempt: { stateHash: true, codeVerifier: true },
} as const satisfies Prisma.GlobalOmitConfig;

export interface DbOptions {
  readonly connectionString: string;
  readonly poolMax: number;
}

/**
 * Opens the pool this process uses for the whole of its lifetime.
 *
 * @param options connection string and pool ceiling, both from validated config
 * @returns a client the caller owns and must `$disconnect` on shutdown
 */
export function createDb(options: DbOptions) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: options.connectionString,
      max: options.poolMax,
    }),
    omit: GLOBAL_OMIT,
    transactionOptions: {
      timeout: 30_000,
    },
  });
}

export type Db = ReturnType<typeof createDb>;
