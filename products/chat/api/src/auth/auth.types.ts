import type {
  AuthProvider,
  AuthSessionResponse,
} from "@chat/contracts/auth/auth";
import type { GrantTtl } from "@chat/contracts/integration/grant-scope";
import type { ToolApprovalMode } from "@chat/contracts/integration/tool-approval-mode";

import type { UserId } from "../db/ids.ts";

export type ChallengePurpose = "verifyEmail" | "verifyPhone" | "phoneLogin";

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
  readonly toolApprovalMode: ToolApprovalMode;
  readonly grantTtl: GrantTtl;
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

export interface AuthSessionRow {
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
  | { readonly kind: "rotated"; readonly session: AuthSessionRow }
  | { readonly kind: "invalid" }
  | { readonly kind: "replayed" };

export type VerificationContact =
  | { readonly email: string }
  | { readonly phoneE164: string };

export interface NewChallenge {
  readonly secretHash: Uint8Array;
  readonly expiresAt: Date;
}

export interface NewUserBase {
  readonly firstName: string;
  readonly lastName: string;
}

export interface OAuthIdentity extends NewUserBase {
  readonly provider: AuthProvider;
  readonly providerAccountId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

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
