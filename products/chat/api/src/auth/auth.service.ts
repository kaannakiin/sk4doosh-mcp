import {
  AUTH_CHALLENGE_MAX_ATTEMPTS,
  AUTH_CHALLENGE_RESEND_MS,
  AUTH_CHALLENGE_TTL_MS,
  type AuthChannel,
  type ChallengeConfirmation,
  type ChallengePurpose as ContractChallengePurpose,
  type EmailRegistration,
  type PasswordLogin,
  type PendingChallenge,
  type PhoneRegistration,
  type VerificationRequest,
} from "@chat/contracts/auth/auth";
import {
  consumeChallengeAndCreateSession,
  createEmailRegistration,
  createPhoneLoginChallenge,
  createPhoneRegistration,
  createVerificationChallenge,
  findChallenge,
  findPasswordLogin,
  isUniqueConstraintError,
  recordChallengeFailure,
  replaceChallenge,
  updatePasswordHash,
  type ChallengePurpose,
  type PendingChallengeRow,
  type VerificationContact,
} from "@chat/db";
import { HttpStatus, Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import { AuthCryptoService, type OtpMaterial } from "./auth-crypto.service.ts";
import { AuthErrorsService } from "./auth-errors.service.ts";
import { AuthSessionService } from "./auth-session.service.ts";
import type { SessionGrant } from "./auth.types.ts";
import { InjectOtpDelivery, type OtpDelivery } from "./otp-delivery.ts";
import { PasswordService } from "./password.service.ts";

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly crypto: AuthCryptoService,
    private readonly passwords: PasswordService,
    private readonly sessions: AuthSessionService,
    private readonly errors: AuthErrorsService,
    @InjectOtpDelivery() private readonly delivery: OtpDelivery,
  ) {}

  async registerEmail(input: EmailRegistration): Promise<PendingChallenge> {
    const [passwordHash, otp] = await Promise.all([
      this.passwords.hash(input.password),
      Promise.resolve(this.crypto.createOtp()),
    ]);
    const expiresAt = this.challengeExpiry();

    try {
      const challenge = await createEmailRegistration(this.db.client, {
        ...input,
        passwordHash,
        challenge: { secretHash: otp.encodedHash, expiresAt },
      });
      await this.deliver(challenge, otp);

      return this.pending(challenge);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        this.errors.fail("account_exists", HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async registerPhone(input: PhoneRegistration): Promise<PendingChallenge> {
    const otp = this.crypto.createOtp();
    const expiresAt = this.challengeExpiry();

    try {
      const challenge = await createPhoneRegistration(this.db.client, {
        ...input,
        challenge: { secretHash: otp.encodedHash, expiresAt },
      });
      await this.deliver(challenge, otp);

      return this.pending(challenge);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        this.errors.fail("account_exists", HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async confirmContact(
    input: ChallengeConfirmation,
    userAgent?: string,
  ): Promise<SessionGrant> {
    return this.confirm(input, ["verifyEmail", "verifyPhone"], userAgent);
  }

  async requestPhoneLogin(phoneE164: string): Promise<PendingChallenge> {
    const otp = this.crypto.createOtp();
    const expiresAt = this.challengeExpiry();
    const challenge = await createPhoneLoginChallenge(
      this.db.client,
      phoneE164,
      { secretHash: otp.encodedHash, expiresAt },
      new Date(Date.now() - AUTH_CHALLENGE_RESEND_MS),
    );
    if (challenge !== undefined) {
      await this.deliver(challenge, otp);

      return this.pending(challenge);
    }

    return this.fakePending(
      "phoneLogin",
      "phone",
      maskPhone(phoneE164),
      new Date(),
    );
  }

  async confirmPhoneLogin(
    input: ChallengeConfirmation,
    userAgent?: string,
  ): Promise<SessionGrant> {
    return this.confirm(input, ["phoneLogin"], userAgent);
  }

  /**
   * Issues a fresh code for an account that was created but never verified.
   *
   * @returns a pending challenge, real or decoy — the two are indistinguishable
   */
  async requestVerification(
    input: VerificationRequest,
  ): Promise<PendingChallenge> {
    const contact = contactOf(input);
    const otp = this.crypto.createOtp();
    const now = new Date();
    const challenge = await createVerificationChallenge(
      this.db.client,
      contact,
      { secretHash: otp.encodedHash, expiresAt: this.challengeExpiry() },
      new Date(now.getTime() - AUTH_CHALLENGE_RESEND_MS),
      now,
    );
    if (challenge !== undefined) {
      await this.deliver(challenge, otp);

      return this.pending(challenge);
    }

    return "email" in contact
      ? this.fakePending(
          "verifyContact",
          "email",
          maskEmail(contact.email),
          now,
        )
      : this.fakePending(
          "verifyContact",
          "phone",
          maskPhone(contact.phoneE164),
          now,
        );
  }

  async resend(challengeId: string): Promise<PendingChallenge> {
    const previous = await findChallenge(this.db.client, challengeId);
    const now = new Date();
    if (
      previous === undefined ||
      previous.consumedAt !== null ||
      previous.expiresAt <= now
    ) {
      this.errors.fail(
        "invalid_or_expired_challenge",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      now.getTime() - previous.createdAt.getTime() <
      AUTH_CHALLENGE_RESEND_MS
    ) {
      this.errors.fail("too_many_requests", HttpStatus.TOO_MANY_REQUESTS);
    }

    const otp = this.crypto.createOtp();
    const next = await replaceChallenge(
      this.db.client,
      previous,
      {
        secretHash: otp.encodedHash,
        expiresAt: this.challengeExpiry(),
      },
      now,
    );
    if (next === undefined) {
      this.errors.fail(
        "invalid_or_expired_challenge",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.deliver(next, otp);

    return this.pending(next);
  }

  async loginPassword(
    input: PasswordLogin,
    userAgent?: string,
  ): Promise<SessionGrant> {
    const found = await findPasswordLogin(this.db.client, input.email);
    if (found === undefined) {
      await this.passwords.burnDummy(input.password);
      this.errors.fail("invalid_credentials", HttpStatus.UNAUTHORIZED);
    }
    const valid = await this.passwords.verify(
      found.passwordHash,
      input.password,
    );
    if (!valid || found.user.disabledAt !== null) {
      this.errors.fail("invalid_credentials", HttpStatus.UNAUTHORIZED);
    }
    if (found.user.emailVerifiedAt === null) {
      this.errors.fail("verification_required", HttpStatus.FORBIDDEN);
    }
    if (this.passwords.needsRehash(found.passwordHash)) {
      await updatePasswordHash(
        this.db.client,
        found.user.internalId,
        await this.passwords.hash(input.password),
      );
    }

    return this.sessions.createForUser(found.user.internalId, userAgent);
  }

  private async confirm(
    input: ChallengeConfirmation,
    allowedPurposes: readonly ChallengePurpose[],
    userAgent?: string,
  ): Promise<SessionGrant> {
    const challenge = await findChallenge(this.db.client, input.challengeId);
    const now = new Date();
    if (
      challenge === undefined ||
      !allowedPurposes.includes(challenge.purpose) ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now ||
      challenge.failedAttempts >= AUTH_CHALLENGE_MAX_ATTEMPTS
    ) {
      this.errors.fail(
        "invalid_or_expired_challenge",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!this.crypto.verifyOtp(challenge.secretHash, input.code)) {
      await recordChallengeFailure(this.db.client, challenge.internalId);
      this.errors.fail(
        "invalid_or_expired_challenge",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const material = this.sessions.createMaterial(userAgent);
    const session = await consumeChallengeAndCreateSession(
      this.db.client,
      challenge,
      material.seed,
      now,
    );
    if (session === undefined) {
      this.errors.fail(
        "invalid_or_expired_challenge",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return this.sessions.grant(session, material.refreshToken);
  }

  private challengeExpiry(): Date {
    return new Date(Date.now() + AUTH_CHALLENGE_TTL_MS);
  }

  private async deliver(
    challenge: PendingChallengeRow,
    otp: OtpMaterial,
  ): Promise<void> {
    await this.delivery.send({
      challengeId: challenge.publicId,
      channel: challenge.purpose === "verifyEmail" ? "email" : "phone",
      maskedTarget: maskTarget(challenge.purpose, challenge.target),
      code: otp.code,
      expiresAt: challenge.expiresAt,
    });
  }

  private pending(challenge: PendingChallengeRow): PendingChallenge {
    return {
      challengeId: challenge.publicId,
      purpose: contractPurpose(challenge.purpose),
      expiresAt: challenge.expiresAt.toISOString(),
      resendAt: new Date(
        challenge.createdAt.getTime() + AUTH_CHALLENGE_RESEND_MS,
      ).toISOString(),
      channel: challenge.purpose === "verifyEmail" ? "email" : "phone",
      maskedTarget: maskTarget(challenge.purpose, challenge.target),
    };
  }

  /**
   * Guard: the decoy is built from the same clock and the same fields as a real
   * pending challenge. Anything that lets the two be told apart — a missing
   * `resendAt`, a rounder expiry — turns this response into an account oracle,
   * which is the one thing the decoy exists to prevent.
   */
  private fakePending(
    purpose: ContractChallengePurpose,
    channel: AuthChannel,
    maskedTarget: string,
    now: Date,
  ): PendingChallenge {
    return {
      challengeId: this.crypto.decoyChallengeId(now),
      purpose,
      expiresAt: new Date(now.getTime() + AUTH_CHALLENGE_TTL_MS).toISOString(),
      resendAt: new Date(
        now.getTime() + AUTH_CHALLENGE_RESEND_MS,
      ).toISOString(),
      channel,
      maskedTarget,
    };
  }
}

function contactOf(input: VerificationRequest): VerificationContact {
  if (input.email !== undefined) {
    return { email: input.email };
  }
  if (input.phoneE164 !== undefined) {
    return { phoneE164: input.phoneE164 };
  }
  throw new Error("verificationRequestSchema admitted a body with no contact");
}

function contractPurpose(purpose: ChallengePurpose): ContractChallengePurpose {
  return purpose === "phoneLogin" ? "phoneLogin" : "verifyContact";
}

function maskTarget(purpose: ChallengePurpose, target: string): string {
  return purpose === "verifyEmail" ? maskEmail(target) : maskPhone(target);
}

function maskEmail(email: string): string {
  const separator = email.indexOf("@");
  if (separator <= 1) {
    return `***${email.slice(Math.max(0, separator))}`;
  }

  return `${email[0]}***${email.slice(separator)}`;
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, Math.min(3, phone.length))}***${phone.slice(-2)}`;
}
