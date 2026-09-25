import {
  WEB_REFRESH_TTL_MS,
  type AuthSessionResponse,
  type PublicUser,
} from "@chat/contracts/auth/auth";
import { HttpStatus, Injectable } from "@nestjs/common";

import { AuthCryptoService } from "./auth-crypto.service.ts";
import { AuthErrorsService } from "./auth-errors.service.ts";
import { AuthSessionRepository } from "./auth-session.repository.ts";
import type {
  AuthPrincipal,
  AuthSessionRow,
  AuthUserRow,
  SessionGrant,
  SessionMaterial,
} from "./auth.types.ts";

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly repository: AuthSessionRepository,
    private readonly crypto: AuthCryptoService,
    private readonly errors: AuthErrorsService,
  ) {}

  createMaterial(userAgent?: string): SessionMaterial {
    const refresh = this.crypto.createRefresh();
    const expiresAt = new Date(Date.now() + WEB_REFRESH_TTL_MS);

    return {
      refreshToken: refresh.token,
      seed: {
        refreshTokenHash: refresh.hash,
        refreshExpiresAt: expiresAt,
        sessionExpiresAt: expiresAt,
        userAgent: userAgent?.slice(0, 512),
      },
    };
  }

  async createForUser(
    userId: string,
    userAgent?: string,
  ): Promise<SessionGrant> {
    const material = this.createMaterial(userAgent);
    const session = await this.repository.createSession(userId, material.seed);

    return this.grant(session, material.refreshToken);
  }

  async grant(
    session: AuthSessionRow,
    refreshToken: string,
  ): Promise<SessionGrant> {
    const accessToken = await this.crypto.signAccess({
      userPublicId: session.user.publicId,
      sessionPublicId: session.publicId,
    });

    return {
      accessToken,
      refreshToken,
      response: { user: this.publicUser(session.user) },
      session,
    };
  }

  async authenticate(accessToken: string | undefined): Promise<AuthPrincipal> {
    if (accessToken === undefined) {
      this.errors.fail("unauthorized", HttpStatus.UNAUTHORIZED);
    }
    const identity = await this.crypto.verifyAccess(accessToken);
    if (identity === undefined) {
      this.errors.fail("unauthorized", HttpStatus.UNAUTHORIZED);
    }
    const session = await this.repository.findActiveSession(
      identity.sessionPublicId,
      new Date(),
    );
    if (
      session === undefined ||
      session.user.publicId !== identity.userPublicId
    ) {
      this.errors.fail("session_expired", HttpStatus.UNAUTHORIZED);
    }

    return { sessionPublicId: session.publicId, user: session.user };
  }

  async optional(
    accessToken: string | undefined,
  ): Promise<AuthPrincipal | undefined> {
    if (accessToken === undefined) {
      return undefined;
    }
    const identity = await this.crypto.verifyAccess(accessToken);
    if (identity === undefined) {
      return undefined;
    }
    const session = await this.repository.findActiveSession(
      identity.sessionPublicId,
      new Date(),
    );

    return session === undefined ||
      session.user.publicId !== identity.userPublicId
      ? undefined
      : { sessionPublicId: session.publicId, user: session.user };
  }

  async refresh(rawToken: string | undefined): Promise<SessionGrant> {
    if (rawToken === undefined) {
      this.errors.fail("session_expired", HttpStatus.UNAUTHORIZED);
    }
    const next = this.crypto.createRefresh();
    const outcome = await this.repository.rotateRefreshToken(
      this.crypto.hashRefresh(rawToken),
      next.hash,
      new Date(Date.now() + WEB_REFRESH_TTL_MS),
      new Date(),
    );
    if (outcome.kind === "superseded") {
      this.errors.fail("refresh_superseded", HttpStatus.CONFLICT);
    }
    if (outcome.kind !== "rotated") {
      this.errors.fail("session_expired", HttpStatus.UNAUTHORIZED);
    }

    return this.grant(outcome.session, next.token);
  }

  async logout(sessionPublicId: string): Promise<void> {
    await this.repository.revokeSession(sessionPublicId, new Date());
  }

  async logoutCurrent(
    accessToken: string | undefined,
    refreshToken: string | undefined,
  ): Promise<void> {
    const principal = await this.optional(accessToken);
    if (principal !== undefined) {
      await this.logout(principal.sessionPublicId);

      return;
    }
    if (refreshToken !== undefined) {
      await this.repository.revokeSessionByRefreshToken(
        this.crypto.hashRefresh(refreshToken),
        new Date(),
      );
    }
  }

  responseFor(user: AuthUserRow): AuthSessionResponse {
    return { user: this.publicUser(user) };
  }

  private publicUser(user: AuthUserRow): PublicUser {
    return {
      id: user.publicId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneE164: user.phoneE164,
      emailVerified: user.emailVerifiedAt !== null,
      phoneVerified: user.phoneVerifiedAt !== null,
      providers: [...user.providers],
      toolApprovalMode: user.toolApprovalMode,
      grantTtl: user.grantTtl,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
