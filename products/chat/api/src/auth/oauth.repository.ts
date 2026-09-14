import type { AuthProvider } from "@chat/contracts/auth/auth";
import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import {
  createSessionForUser,
  toSession,
  toUser,
  userInclude,
} from "./auth-rows.ts";
import type {
  AuthSessionRow,
  AuthUserRow,
  OAuthIdentity,
  SessionSeed,
} from "./auth.types.ts";

@Injectable()
export class OAuthRepository {
  constructor(private readonly db: DbService) {}

  async findOAuthUser(
    provider: AuthProvider,
    providerAccountId: string,
  ): Promise<AuthUserRow | undefined> {
    const account = await this.db.client.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: { provider, providerAccountId },
      },
      include: { user: { include: userInclude } },
    });
    if (account === null) {
      return undefined;
    }

    await this.db.client.oAuthAccount.update({
      where: { id: account.id },
      data: { lastUsedAt: new Date() },
    });

    return toUser(account.user);
  }

  async findUserByVerifiedEmail(
    email: string,
  ): Promise<AuthUserRow | undefined> {
    const user = await this.db.client.user.findFirst({
      where: { email, emailVerifiedAt: { not: null } },
      include: userInclude,
    });

    return user === null ? undefined : toUser(user);
  }

  async createOAuthUserAndSession(
    identity: OAuthIdentity,
    seed: SessionSeed,
  ): Promise<AuthSessionRow> {
    return this.db.client.$transaction(async (tx) => {
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

  async linkOAuthAccount(
    userId: string,
    provider: AuthProvider,
    providerAccountId: string,
  ): Promise<AuthUserRow> {
    return this.db.client.$transaction(async (tx) => {
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
}
