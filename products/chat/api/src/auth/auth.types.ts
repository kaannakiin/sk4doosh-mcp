import type { AuthSessionResponse } from "@chat/contracts/auth/auth";
import type { AuthSessionRow, AuthUserRow, SessionSeed } from "@chat/db";

export interface SessionMaterial {
  readonly refreshToken: string;
  readonly seed: SessionSeed;
}

export interface SessionGrant {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly response: AuthSessionResponse;
  readonly session: AuthSessionRow;
}

export interface AuthPrincipal {
  readonly sessionPublicId: string;
  readonly user: AuthUserRow;
}
