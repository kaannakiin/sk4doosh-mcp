import type { AuthProvider } from "@chat/contracts/auth/auth";

import type { Db } from "./client.js";

export type ChallengePurpose = "verifyEmail" | "verifyPhone" | "phoneLogin";

export type UserId = string & { readonly __userId: unique symbol };

export interface AuthUserRow {
  readonly internalId: UserId;
  readonly publicId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
  readonly phoneE164: string | null;
  readonly emailVerifiedAt: Date | null;
  readonly phoneVerifiedAt: Date | null;
  readonly disabledAt: Date | null;
  readonly createdAt: Date;
  readonly providers: readonly AuthProvider[];
}

export interface ChallengeRow {
  readonly internalId: string;
  readonly publicId: string;
  readonly userId: string;
  readonly purpose: ChallengePurpose;
  readonly target: string;
  readonly secretHash: Uint8Array;
  readonly failedAttempts: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface PendingChallengeRow {
  readonly publicId: string;
  readonly purpose: ChallengePurpose;
  readonly target: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface SessionSeed {
  readonly refreshTokenHash: Uint8Array;
  readonly refreshExpiresAt: Date;
  readonly sessionExpiresAt: Date;
  readonly userAgent?: string;
  readonly deviceName?: string;
}

export interface SessionRow {
  readonly publicId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly user: AuthUserRow;
}

export interface PasswordLoginRow {
  readonly user: AuthUserRow;
  readonly passwordHash: string;
}

export type RefreshOutcome =
  | { readonly kind: "rotated"; readonly session: SessionRow }
  | { readonly kind: "invalid" }
  | { readonly kind: "replayed" };

interface NewChallenge {
  readonly secretHash: Uint8Array;
  readonly expiresAt: Date;
}

interface NewUserBase {
  readonly firstName: string;
  readonly lastName: string;
}

interface OAuthIdentity extends NewUserBase {
  readonly provider: AuthProvider;
  readonly providerAccountId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

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

function providerOf(raw: string): AuthProvider | undefined {
  return raw === "google" || raw === "github" ? raw : undefined;
}

function challengePurposeOf(raw: string): ChallengePurpose {
  if (raw === "verifyEmail" || raw === "verifyPhone" || raw === "phoneLogin") {
    return raw;
  }

  throw new Error(`unsupported auth challenge purpose: ${raw}`);
}

function toUser(row: UserShape): AuthUserRow {
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

const userInclude = {
  oauthAccounts: { select: { provider: true } },
} as const;

function toPending(row: {
  publicId: string;
  purpose: string;
  target: string;
  createdAt: Date;
  expiresAt: Date;
}): PendingChallengeRow {
  return { ...row, purpose: challengePurposeOf(row.purpose) };
}

function toSession(row: {
  publicId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: UserShape;
}): SessionRow {
  return {
    publicId: row.publicId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    user: toUser(row.user),
  };
}

async function createSessionForUser(
  tx: Parameters<Parameters<Db["$transaction"]>[0]>[0],
  userId: bigint,
  seed: SessionSeed,
) {
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

export async function createEmailRegistration(
  db: Db,
  input: NewUserBase & {
    readonly email: string;
    readonly passwordHash: string;
    readonly challenge: NewChallenge;
  },
): Promise<PendingChallengeRow> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        passwordCredential: {
          create: { passwordHash: input.passwordHash },
        },
      },
    });
    const challenge = await tx.authChallenge.create({
      data: {
        userId: user.id,
        purpose: "verifyEmail",
        target: input.email,
        secretHash: Buffer.from(input.challenge.secretHash),
        expiresAt: input.challenge.expiresAt,
      },
    });

    return toPending(challenge);
  });
}

export async function createPhoneRegistration(
  db: Db,
  input: NewUserBase & {
    readonly phoneE164: string;
    readonly challenge: NewChallenge;
  },
): Promise<PendingChallengeRow> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phoneE164: input.phoneE164,
      },
    });
    const challenge = await tx.authChallenge.create({
      data: {
        userId: user.id,
        purpose: "verifyPhone",
        target: input.phoneE164,
        secretHash: Buffer.from(input.challenge.secretHash),
        expiresAt: input.challenge.expiresAt,
      },
    });

    return toPending(challenge);
  });
}

export async function createPhoneLoginChallenge(
  db: Db,
  phoneE164: string,
  challenge: NewChallenge,
  cooldownStartedAfter: Date,
): Promise<PendingChallengeRow | undefined> {
  return db.$transaction(async (tx) => {
    // One target can be requested from many IPs. The transaction-scoped advisory
    // lock makes the cooldown check and insert atomic for that target.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${phoneE164}, 0))`;
    const user = await tx.user.findFirst({
      where: {
        phoneE164,
        phoneVerifiedAt: { not: null },
        disabledAt: null,
      },
      select: { id: true },
    });
    if (user === null) {
      return undefined;
    }
    const recent = await tx.authChallenge.findFirst({
      where: {
        target: phoneE164,
        purpose: "phoneLogin",
        createdAt: { gt: cooldownStartedAfter },
      },
      select: { id: true },
    });
    if (recent !== null) {
      return undefined;
    }

    return toPending(
      await tx.authChallenge.create({
        data: {
          userId: user.id,
          purpose: "phoneLogin",
          target: phoneE164,
          secretHash: Buffer.from(challenge.secretHash),
          expiresAt: challenge.expiresAt,
        },
      }),
    );
  });
}

export async function findChallenge(
  db: Db,
  publicId: string,
): Promise<ChallengeRow | undefined> {
  const found = await db.authChallenge.findUnique({
    where: { publicId },
    omit: { secretHash: false },
  });
  if (found === null || found.purpose === "passwordReset") {
    return undefined;
  }

  return {
    internalId: found.id.toString(),
    publicId: found.publicId,
    userId: found.userId.toString(),
    purpose: found.purpose,
    target: found.target,
    secretHash: found.secretHash,
    failedAttempts: found.failedAttempts,
    createdAt: found.createdAt,
    expiresAt: found.expiresAt,
    consumedAt: found.consumedAt,
  };
}

export async function recordChallengeFailure(
  db: Db,
  internalId: string,
): Promise<void> {
  await db.authChallenge.updateMany({
    where: {
      id: BigInt(internalId),
      consumedAt: null,
    },
    data: { failedAttempts: { increment: 1 } },
  });
}

export async function replaceChallenge(
  db: Db,
  previous: ChallengeRow,
  challenge: NewChallenge,
  now: Date,
): Promise<PendingChallengeRow | undefined> {
  return db.$transaction(async (tx) => {
    const consumed = await tx.authChallenge.updateMany({
      where: {
        id: BigInt(previous.internalId),
        consumedAt: null,
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      return undefined;
    }

    return toPending(
      await tx.authChallenge.create({
        data: {
          userId: BigInt(previous.userId),
          purpose: previous.purpose,
          target: previous.target,
          secretHash: Buffer.from(challenge.secretHash),
          expiresAt: challenge.expiresAt,
        },
      }),
    );
  });
}

export async function consumeChallengeAndCreateSession(
  db: Db,
  challenge: ChallengeRow,
  seed: SessionSeed,
  now: Date,
): Promise<SessionRow | undefined> {
  return db.$transaction(async (tx) => {
    const consumed = await tx.authChallenge.updateMany({
      where: {
        id: BigInt(challenge.internalId),
        consumedAt: null,
        expiresAt: { gt: now },
        failedAttempts: { lt: 5 },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      return undefined;
    }

    if (challenge.purpose === "verifyEmail") {
      await tx.user.update({
        where: { id: BigInt(challenge.userId) },
        data: { emailVerifiedAt: now },
      });
    } else if (challenge.purpose === "verifyPhone") {
      await tx.user.update({
        where: { id: BigInt(challenge.userId) },
        data: { phoneVerifiedAt: now },
      });
    }

    return toSession(
      await createSessionForUser(tx, BigInt(challenge.userId), seed),
    );
  });
}

export async function findPasswordLogin(
  db: Db,
  email: string,
): Promise<PasswordLoginRow | undefined> {
  const found = await db.user.findUnique({
    where: { email },
    include: {
      ...userInclude,
      passwordCredential: { omit: { passwordHash: false } },
    },
  });
  if (found === null || found.passwordCredential === null) {
    return undefined;
  }

  return {
    user: toUser(found),
    passwordHash: found.passwordCredential.passwordHash,
  };
}

export async function updatePasswordHash(
  db: Db,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db.userPasswordCredential.update({
    where: { userId: BigInt(userId) },
    data: { passwordHash, passwordChangedAt: new Date() },
  });
}

export async function createSession(
  db: Db,
  userId: string,
  seed: SessionSeed,
): Promise<SessionRow> {
  return toSession(
    await db.$transaction((tx) =>
      createSessionForUser(tx, BigInt(userId), seed),
    ),
  );
}

export async function findActiveSession(
  db: Db,
  publicId: string,
  now: Date,
): Promise<SessionRow | undefined> {
  const found = await db.authSession.findUnique({
    where: { publicId },
    include: { user: { include: userInclude } },
  });
  if (
    found === null ||
    found.revokedAt !== null ||
    found.expiresAt <= now ||
    found.user.disabledAt !== null
  ) {
    return undefined;
  }

  return toSession(found);
}

export async function rotateRefreshToken(
  db: Db,
  currentHash: Uint8Array,
  nextHash: Uint8Array,
  nextExpiresAt: Date,
  now: Date,
): Promise<RefreshOutcome> {
  return db.$transaction(async (tx) => {
    const current = await tx.authRefreshToken.findUnique({
      where: { tokenHash: Buffer.from(currentHash) },
      include: {
        session: { include: { user: { include: userInclude } } },
      },
    });
    if (
      current === null ||
      current.expiresAt <= now ||
      current.session.expiresAt <= now ||
      current.session.revokedAt !== null ||
      current.session.user.disabledAt !== null
    ) {
      return { kind: "invalid" };
    }

    const consumed = await tx.authRefreshToken.updateMany({
      where: { id: current.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      await tx.authSession.update({
        where: { id: current.sessionId },
        data: { revokedAt: now },
      });

      return { kind: "replayed" };
    }

    await tx.authRefreshToken.create({
      data: {
        sessionId: current.sessionId,
        generation: current.generation + 1,
        tokenHash: Buffer.from(nextHash),
        expiresAt: nextExpiresAt,
      },
    });
    await tx.authSession.update({
      where: { id: current.sessionId },
      data: { lastSeenAt: now },
    });

    return { kind: "rotated", session: toSession(current.session) };
  });
}

export async function revokeSession(
  db: Db,
  publicId: string,
  now: Date,
): Promise<void> {
  await db.authSession.updateMany({
    where: { publicId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function revokeSessionByRefreshToken(
  db: Db,
  tokenHash: Uint8Array,
  now: Date,
): Promise<void> {
  const token = await db.authRefreshToken.findUnique({
    where: { tokenHash: Buffer.from(tokenHash) },
    select: { sessionId: true },
  });
  if (token === null) {
    return;
  }

  await db.authSession.updateMany({
    where: { id: token.sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function findOAuthUser(
  db: Db,
  provider: AuthProvider,
  providerAccountId: string,
): Promise<AuthUserRow | undefined> {
  const account = await db.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: { provider, providerAccountId },
    },
    include: { user: { include: userInclude } },
  });
  if (account === null) {
    return undefined;
  }

  await db.oAuthAccount.update({
    where: { id: account.id },
    data: { lastUsedAt: new Date() },
  });

  return toUser(account.user);
}

export async function findUserByVerifiedEmail(
  db: Db,
  email: string,
): Promise<AuthUserRow | undefined> {
  const user = await db.user.findFirst({
    where: { email, emailVerifiedAt: { not: null } },
    include: userInclude,
  });

  return user === null ? undefined : toUser(user);
}

export async function createOAuthUserAndSession(
  db: Db,
  identity: OAuthIdentity,
  seed: SessionSeed,
): Promise<SessionRow> {
  return db.$transaction(async (tx) => {
    const now = new Date();
    const user = await tx.user.create({
      data: {
        firstName: identity.firstName,
        lastName: identity.lastName,
        email: identity.email,
        emailVerifiedAt:
          identity.email !== null && identity.emailVerified ? now : null,
        oauthAccounts: {
          create: {
            provider: identity.provider,
            providerAccountId: identity.providerAccountId,
          },
        },
      },
    });

    return toSession(await createSessionForUser(tx, user.id, seed));
  });
}

export async function linkOAuthAccount(
  db: Db,
  userId: string,
  provider: AuthProvider,
  providerAccountId: string,
): Promise<AuthUserRow> {
  return db.$transaction(async (tx) => {
    await tx.oAuthAccount.create({
      data: {
        userId: BigInt(userId),
        provider,
        providerAccountId,
      },
    });
    return toUser(
      await tx.user.findUniqueOrThrow({
        where: { id: BigInt(userId) },
        include: userInclude,
      }),
    );
  });
}
