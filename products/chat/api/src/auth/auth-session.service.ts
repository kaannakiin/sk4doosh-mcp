import {
  WEB_REFRESH_TTL_MS,
  type AuthSessionResponse,
  type PublicUser,
} from "@chat/contracts/auth/auth";
import {
  createSession,
  findActiveSession,
  revokeSession,
  revokeSessionByRefreshToken,
  rotateRefreshToken,
  type AuthSessionRow,
  type AuthUserRow,
} from "@chat/db";
import { HttpStatus, Injectable } from "@nestjs/common";
import { DbService } from "../db/db.service.ts";
import { AuthCryptoService } from "./auth-crypto.service.ts";
import { AuthErrorsService } from "./auth-errors.service.ts";
import type {
  AuthPrincipal,
  SessionGrant,
  SessionMaterial,
} from "./auth.types.ts";

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly db: DbService,
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
    const session = await createSession(
      this.db.client,
      userId,
      material.seed,
    );

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
    const session = await findActiveSession(
      this.db.client,
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

  async optional(accessToken: string | undefined): Promise<AuthPrincipal | undefined> {
    if (accessToken === undefined) {
      return undefined;
    }
    const identity = await this.crypto.verifyAccess(accessToken);
    if (identity === undefined) {
      return undefined;
    }
    const session = await findActiveSession(
      this.db.client,
      identity.sessionPublicId,
      new Date(),
    );

    return session === undefined || session.user.publicId !== identity.userPublicId
      ? undefined
      : { sessionPublicId: session.publicId, user: session.user };
  }

  async refresh(rawToken: string | undefined): Promise<SessionGrant> {
    if (rawToken === undefined) {
      this.errors.fail("session_expired", HttpStatus.UNAUTHORIZED);
    }
    const next = this.crypto.createRefresh();
    const outcome = await rotateRefreshToken(
      this.db.client,
      this.crypto.hashRefresh(rawToken),
      next.hash,
      new Date(Date.now() + WEB_REFRESH_TTL_MS),
      new Date(),
    );
    if (outcome.kind !== "rotated") {
      this.errors.fail("session_expired", HttpStatus.UNAUTHORIZED);
    }

    return this.grant(outcome.session, next.token);
  }

  async logout(sessionPublicId: string): Promise<void> {
    await revokeSession(this.db.client, sessionPublicId, new Date());
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
      await revokeSessionByRefreshToken(
        this.db.client,
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
      createdAt: user.createdAt.toISOString(),
    };
  }
}
