import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import { createSessionForUser, toSession, userInclude } from "./auth-rows.ts";
import type {
  AuthSessionRow,
  RefreshOutcome,
  SessionSeed,
} from "./auth.types.ts";

@Injectable()
export class AuthSessionRepository {
  constructor(private readonly db: DbService) {}

  async createSession(
    userId: string,
    seed: SessionSeed,
  ): Promise<AuthSessionRow> {
    return toSession(
      await this.db.client.$transaction((tx) =>
        createSessionForUser(tx, BigInt(userId), seed),
      ),
    );
  }

  async findActiveSession(
    publicId: string,
    now: Date,
  ): Promise<AuthSessionRow | undefined> {
    const found = await this.db.client.authSession.findUnique({
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

  async rotateRefreshToken(
    currentHash: Uint8Array,
    nextHash: Uint8Array,
    nextExpiresAt: Date,
    now: Date,
  ): Promise<RefreshOutcome> {
    return this.db.client.$transaction(async (tx) => {
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

  async revokeSession(publicId: string, now: Date): Promise<void> {
    await this.db.client.authSession.updateMany({
      where: { publicId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeSessionByRefreshToken(
    tokenHash: Uint8Array,
    now: Date,
  ): Promise<void> {
    const token = await this.db.client.authRefreshToken.findUnique({
      where: { tokenHash: Buffer.from(tokenHash) },
      select: { sessionId: true },
    });
    if (token === null) {
      return;
    }

    await this.db.client.authSession.updateMany({
      where: { id: token.sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
