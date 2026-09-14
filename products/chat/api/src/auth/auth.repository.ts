import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import {
  createSessionForUser,
  toPending,
  toSession,
  toUser,
  userInclude,
} from "./auth-rows.ts";
import type {
  AuthSessionRow,
  AuthUserRow,
  ChallengeRow,
  NewChallenge,
  NewUserBase,
  PasswordLoginRow,
  PendingChallengeRow,
  SessionSeed,
  VerificationContact,
} from "./auth.types.ts";

@Injectable()
export class AuthRepository {
  constructor(private readonly db: DbService) {}

  async createEmailRegistration(
    input: NewUserBase & {
      readonly email: string;
      readonly passwordHash: string;
      readonly challenge: NewChallenge;
    },
  ): Promise<PendingChallengeRow> {
    return this.db.client.$transaction(async (tx) => {
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

  async createPhoneRegistration(
    input: NewUserBase & {
      readonly phoneE164: string;
      readonly challenge: NewChallenge;
    },
  ): Promise<PendingChallengeRow> {
    return this.db.client.$transaction(async (tx) => {
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

  /**
   * Issues a fresh contact-verification challenge for an account that was created
   * but never verified, consuming any challenge still open for it.
   *
   * @param cooldownStartedAfter challenges created after this instant block a new one
   * @returns the pending challenge, or `undefined` when nothing may be issued
   */
  async createVerificationChallenge(
    contact: VerificationContact,
    challenge: NewChallenge,
    cooldownStartedAfter: Date,
    now: Date,
  ): Promise<PendingChallengeRow | undefined> {
    const byEmail = "email" in contact;
    const target = byEmail ? contact.email : contact.phoneE164;
    const purpose = byEmail ? "verifyEmail" : "verifyPhone";

    return this.db.client.$transaction(async (tx) => {
      // One target can be requested from many IPs. The transaction-scoped advisory
      // lock makes the cooldown check and insert atomic for that target.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${target}, 0))`;
      const user = await tx.user.findFirst({
        where: byEmail
          ? { email: target, emailVerifiedAt: null, disabledAt: null }
          : { phoneE164: target, phoneVerifiedAt: null, disabledAt: null },
        select: { id: true },
      });
      if (user === null) {
        return undefined;
      }
      const recent = await tx.authChallenge.findFirst({
        where: { target, purpose, createdAt: { gt: cooldownStartedAfter } },
        select: { id: true },
      });
      if (recent !== null) {
        return undefined;
      }
      /**
       * Guard: every open challenge for this target is consumed before the new one
       * is written. Leaving them live would let a code the caller has already
       * abandoned still open the account, and would widen the five-attempt budget
       * to five per outstanding challenge.
       */
      await tx.authChallenge.updateMany({
        where: { userId: user.id, purpose, consumedAt: null },
        data: { consumedAt: now },
      });

      return toPending(
        await tx.authChallenge.create({
          data: {
            userId: user.id,
            purpose,
            target,
            secretHash: Buffer.from(challenge.secretHash),
            expiresAt: challenge.expiresAt,
          },
        }),
      );
    });
  }

  async createPhoneLoginChallenge(
    phoneE164: string,
    challenge: NewChallenge,
    cooldownStartedAfter: Date,
  ): Promise<PendingChallengeRow | undefined> {
    return this.db.client.$transaction(async (tx) => {
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

  async findChallenge(publicId: string): Promise<ChallengeRow | undefined> {
    const found = await this.db.client.authChallenge.findUnique({
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

  async recordChallengeFailure(internalId: string): Promise<void> {
    await this.db.client.authChallenge.updateMany({
      where: {
        id: BigInt(internalId),
        consumedAt: null,
      },
      data: { failedAttempts: { increment: 1 } },
    });
  }

  async replaceChallenge(
    previous: ChallengeRow,
    challenge: NewChallenge,
    now: Date,
  ): Promise<PendingChallengeRow | undefined> {
    return this.db.client.$transaction(async (tx) => {
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

  async consumeChallengeAndCreateSession(
    challenge: ChallengeRow,
    seed: SessionSeed,
    now: Date,
  ): Promise<AuthSessionRow | undefined> {
    return this.db.client.$transaction(async (tx) => {
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

  async findPasswordLogin(email: string): Promise<PasswordLoginRow | undefined> {
    const found = await this.db.client.user.findUnique({
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

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.db.client.userPasswordCredential.update({
      where: { userId: BigInt(userId) },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
  }

  /**
   * Creates an email/password account already past contact verification, or resets
   * an existing one to the given name and password.
   *
   * Guard: this is the one path that mints a verified account without an
   * `AuthChallenge`, and on an address that already exists it overwrites the
   * password credential. It exists for seeding a database an operator controls;
   * never reach for it from a request handler, where the challenge flow is what
   * proves the address belongs to the caller.
   *
   * @param now stamped as both the verification and the password-change instant
   * @returns the account as the rest of the auth surface sees it
   */
  async upsertVerifiedUser(
    input: NewUserBase & {
      readonly email: string;
      readonly passwordHash: string;
      readonly now: Date;
    },
  ): Promise<AuthUserRow> {
    const row = await this.db.client.user.upsert({
      where: { email: input.email },
      create: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        emailVerifiedAt: input.now,
        passwordCredential: { create: { passwordHash: input.passwordHash } },
      },
      update: {
        firstName: input.firstName,
        lastName: input.lastName,
        emailVerifiedAt: input.now,
        disabledAt: null,
        passwordCredential: {
          upsert: {
            create: { passwordHash: input.passwordHash },
            update: {
              passwordHash: input.passwordHash,
              passwordChangedAt: input.now,
            },
          },
        },
      },
      include: userInclude,
    });

    return toUser(row);
  }
}
