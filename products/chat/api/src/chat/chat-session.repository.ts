import { SESSION_PIN_LIMIT } from "@chat/contracts/chat/session-limits";
import type { SessionPage, SessionRow } from "@chat/db";
import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import type { UserId } from "../db/ids.ts";

type SessionRecord = {
  id: bigint;
  publicId: string;
  title: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt: Date;
  pinnedAt: Date | null;
};

function toRow(record: SessionRecord): SessionRow {
  return {
    id: record.publicId,
    title: record.title,
    messageCount: record.messageCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastOpenedAt: record.lastOpenedAt,
    pinnedAt: record.pinnedAt,
  };
}

export interface SessionListQuery {
  readonly limit: number;
  readonly cursor?: { readonly openedAt: Date; readonly id: string };
}

export type PinOutcome =
  | { readonly kind: "pinned"; readonly row: SessionRow }
  | { readonly kind: "not_found" }
  | { readonly kind: "limit" };

@Injectable()
export class ChatSessionRepository {
  constructor(private readonly db: DbService) {}

  /**
   * One page of a user's unpinned conversations, most recently opened first.
   *
   * Guard: the keyset compares `(last_opened_at, id)` against the cursor's position,
   * and the cursor's public id is resolved to its surrogate in the same statement.
   * Ordering on the surrogate rather than on the public id is what lets
   * `chat_session_user_recent_idx` satisfy the sort without a sort node, while the
   * cursor the client holds still names nothing internal.
   *
   * @param query `limit` rows are returned; one extra is read to decide whether more exist
   */
  async listSessions(
    userId: UserId,
    query: SessionListQuery,
  ): Promise<SessionPage> {
    const user = BigInt(userId);
    const cursor = query.cursor;
    const records = await this.db.client.chatSession.findMany({
      where: {
        userId: user,
        deletedAt: null,
        pinnedAt: null,
        ...(cursor === undefined
          ? {}
          : {
              OR: [
                { lastOpenedAt: { lt: cursor.openedAt } },
                {
                  lastOpenedAt: cursor.openedAt,
                  id: { lt: await this.surrogateOf(user, cursor.id) },
                },
              ],
            }),
      },
      orderBy: [{ lastOpenedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });

    const page = records.slice(0, query.limit);
    const last = page.at(-1);

    return {
      sessions: page.map(toRow),
      nextCursor:
        records.length > query.limit && last !== undefined
          ? { openedAt: last.lastOpenedAt, id: last.publicId }
          : undefined,
    };
  }

  async listPinned(userId: UserId): Promise<readonly SessionRow[]> {
    const records = await this.db.client.chatSession.findMany({
      where: {
        userId: BigInt(userId),
        deletedAt: null,
        pinnedAt: { not: null },
      },
      orderBy: [{ pinnedAt: "desc" }, { id: "desc" }],
      take: SESSION_PIN_LIMIT,
    });

    return records.map(toRow);
  }

  /**
   * Moves a conversation to the head of the list.
   *
   * Guard: `last_opened_at` only ever moves forward, so a bumped row leaves the
   * region below every cursor already handed out. Pages the visitor has loaded
   * can therefore never repeat or skip it, which is what makes a sort key that
   * changes on every open safe to page over.
   *
   * Guard: `now()` is the database's clock, the same one the turn reconcile
   * writes with. Mixing in the api's clock would let an open and a turn a few
   * milliseconds apart land in the wrong order.
   */
  async markOpened(userId: UserId, sessionId: string): Promise<void> {
    await this.db.client.$executeRaw`
      update chat_session
         set last_opened_at = now()
       where public_id = ${sessionId}::uuid
         and user_id = ${BigInt(userId)}
         and deleted_at is null
    `;
  }

  /**
   * Pins a conversation, up to `SESSION_PIN_LIMIT` per user.
   *
   * Guard: the user row is locked before the count. Without the lock two pins
   * racing at the cap both read one below it and both write, which leaves the
   * limit advisory and the pinned list longer than the page that carries it.
   */
  async pinSession(userId: UserId, sessionId: string): Promise<PinOutcome> {
    const user = BigInt(userId);

    return this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw<{ id: bigint }[]>`
        select id from app_user where id = ${user} for update
      `;
      const target = await tx.chatSession.findFirst({
        where: { publicId: sessionId, userId: user, deletedAt: null },
      });
      if (target === null) {
        return { kind: "not_found" };
      }
      if (target.pinnedAt !== null) {
        return { kind: "pinned", row: toRow(target) };
      }

      const pinned = await tx.chatSession.count({
        where: { userId: user, deletedAt: null, pinnedAt: { not: null } },
      });
      if (pinned >= SESSION_PIN_LIMIT) {
        return { kind: "limit" };
      }

      const updated = await tx.chatSession.update({
        where: { id: target.id },
        data: { pinnedAt: new Date() },
      });

      return { kind: "pinned", row: toRow(updated) };
    });
  }

  async unpinSession(
    userId: UserId,
    sessionId: string,
  ): Promise<SessionRow | undefined> {
    const { count } = await this.db.client.chatSession.updateMany({
      where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
      data: { pinnedAt: null },
    });

    return count === 0 ? undefined : this.findSession(userId, sessionId);
  }

  private async surrogateOf(userId: bigint, publicId: string): Promise<bigint> {
    const found = await this.db.client.chatSession.findFirst({
      where: { publicId, userId },
      select: { id: true },
    });

    return found?.id ?? BigInt(0);
  }

  /**
   * Counts a user's attachments per session, for the list response.
   *
   * @returns a map from public session id to its live attachment count
   */
  async attachmentCounts(
    userId: UserId,
    sessionIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (sessionIds.length === 0) {
      return new Map();
    }

    const rows = await this.db.client.chatSession.findMany({
      where: { userId: BigInt(userId), publicId: { in: [...sessionIds] } },
      select: {
        publicId: true,
        _count: { select: { attachments: { where: { deletedAt: null } } } },
      },
    });

    return new Map(rows.map((row) => [row.publicId, row._count.attachments]));
  }

  /**
   * Marks a conversation deleted without touching its rows' children.
   *
   * @returns `false` when the session does not exist or belongs to somebody else
   */
  async softDeleteSession(userId: UserId, sessionId: string): Promise<boolean> {
    const { count } = await this.db.client.chatSession.updateMany({
      where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
      data: { deletedAt: new Date() },
    });

    return count > 0;
  }

  async findSession(
    userId: UserId,
    sessionId: string,
  ): Promise<SessionRow | undefined> {
    const found = await this.db.client.chatSession.findFirst({
      where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
    });

    return found === null ? undefined : toRow(found);
  }

  /**
   * Renames a conversation.
   *
   * Guard: written with `updateMany` rather than `update`, so the user predicate
   * sits in the same statement as the write. `update` keys on a unique column and
   * cannot carry one, which would turn a guessed public id into somebody else's
   * retitled session.
   *
   * Guard: `updated_at` is deliberately untouched. It orders the session list and
   * anchors its keyset cursor, so bumping it on a rename would jump the row to the
   * top of the sidebar under the visitor's cursor and shift every page boundary
   * behind it.
   *
   * @returns the renamed row, or `undefined` when it is not this user's
   */
  async renameSession(
    userId: UserId,
    sessionId: string,
    title: string,
  ): Promise<SessionRow | undefined> {
    const { count } = await this.db.client.chatSession.updateMany({
      where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
      data: { title },
    });

    return count === 0 ? undefined : this.findSession(userId, sessionId);
  }

  /**
   * The Codex thread this conversation continues, if it has one.
   *
   * @returns the agent runtime's thread id, or `undefined` when no agent has run
   */
  async codexThreadFor(
    userId: UserId,
    sessionId: string,
  ): Promise<string | undefined> {
    const found = await this.db.client.chatSession.findFirst({
      where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
      select: { codexThreadId: true },
    });

    return found?.codexThreadId ?? undefined;
  }

  /**
   * Records the thread a Codex run started, so the next one resumes it.
   *
   * Guard: written with `updateMany` for the same reason `renameSession` is —
   * the user predicate has to sit in the same statement as the write.
   *
   * Guard: `updated_at` is left alone. A conversation's position in the sidebar
   * is set by the turn that produced this thread, not by the bookkeeping that
   * remembers it.
   */
  async rememberCodexThread(
    userId: UserId,
    sessionId: string,
    threadId: string,
  ): Promise<void> {
    await this.db.client.chatSession.updateMany({
      where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
      data: { codexThreadId: threadId },
    });
  }

  async agentThreadFor(
    userId: UserId,
    sessionId: string,
  ): Promise<string | undefined> {
    const found = await this.db.client.chatSession.findFirst({
      where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
      select: { agentThreadId: true },
    });

    return found?.agentThreadId ?? undefined;
  }

  async rememberAgentThread(
    userId: UserId,
    sessionId: string,
    threadId: string,
  ): Promise<void> {
    await this.db.client.chatSession.updateMany({
      where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
      data: { agentThreadId: threadId },
    });
  }
}
