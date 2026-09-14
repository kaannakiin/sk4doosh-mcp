import type { AuthProvider } from "@chat/contracts/auth/auth";
import type { Db } from "@chat/db";

import type { UserId } from "../db/ids.ts";
import type {
  AuthSessionRow,
  AuthUserRow,
  ChallengePurpose,
  PendingChallengeRow,
  SessionSeed,
} from "./auth.types.ts";

export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

interface UserShape {
  readonly id: bigint;
  readonly publicId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
  readonly phoneE164: string | null;
  readonly emailVerifiedAt: Date | null;
  readonly phoneVerifiedAt: Date | null;
  readonly disabledAt: Date | null;
  readonly createdAt: Date;
  readonly oauthAccounts: readonly { readonly provider: string }[];
}

export const userInclude = {
  oauthAccounts: { select: { provider: true } },
} as const;

function providerOf(raw: string): AuthProvider | undefined {
  return raw === "google" || raw === "github" ? raw : undefined;
}

function challengePurposeOf(raw: string): ChallengePurpose {
  if (raw === "verifyEmail" || raw === "verifyPhone" || raw === "phoneLogin") {
    return raw;
  }

  throw new Error(`unsupported auth challenge purpose: ${raw}`);
}

export function toUser(row: UserShape): AuthUserRow {
  return {
    internalId: row.id.toString() as UserId,
    publicId: row.publicId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phoneE164: row.phoneE164,
    emailVerifiedAt: row.emailVerifiedAt,
    phoneVerifiedAt: row.phoneVerifiedAt,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
    providers: row.oauthAccounts
      .map(({ provider }) => providerOf(provider))
      .filter((provider): provider is AuthProvider => provider !== undefined),
  };
}

export function toPending(row: {
  publicId: string;
  purpose: string;
  target: string;
  createdAt: Date;
  expiresAt: Date;
}): PendingChallengeRow {
  return { ...row, purpose: challengePurposeOf(row.purpose) };
}

interface SessionShape {
  readonly publicId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly user: UserShape;
}

export function toSession(row: SessionShape): AuthSessionRow {
  return {
    publicId: row.publicId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    user: toUser(row.user),
  };
}

/**
 * Opens a session row and its first refresh token inside a caller's transaction.
 *
 * Guard: takes the transaction rather than the client because all three callers
 * open the session together with something else that must not commit without it —
 * a consumed challenge, a verified contact, a freshly created OAuth user.
 *
 * Guard: the return type is written out rather than inferred. Prisma infers a
 * shape naming `AuthClientType` from the generated enums, which `@chat/db` does
 * not export — TS2883 — and widening that barrel to satisfy one inference would
 * put the generated enum module on every consumer's path.
 */
export async function createSessionForUser(
  tx: Tx,
  userId: bigint,
  seed: SessionSeed,
): Promise<SessionShape> {
  return tx.authSession.create({
    data: {
      userId,
      clientType: "web",
      deviceName: seed.deviceName,
      userAgent: seed.userAgent,
      expiresAt: seed.sessionExpiresAt,
      refreshTokens: {
        create: {
          generation: 0,
          tokenHash: Buffer.from(seed.refreshTokenHash),
          expiresAt: seed.refreshExpiresAt,
        },
      },
    },
    include: { user: { include: userInclude } },
  });
}
