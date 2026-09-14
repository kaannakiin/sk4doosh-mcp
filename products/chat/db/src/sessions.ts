import type { UserId } from "./auth.js";
import type { Db } from "./client.js";
import type { SessionPage, SessionRow } from "./rows.js";

type SessionRecord = {
  id: bigint;
  publicId: string;
  title: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
};

function toRow(record: SessionRecord): SessionRow {
  return {
    id: record.publicId,
    title: record.title,
    messageCount: record.messageCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export interface SessionListQuery {
  readonly limit: number;
  readonly cursor?: { readonly updatedAt: Date; readonly id: string };
}

/**
 * One page of a user's conversations, newest first.
 *
 * Guard: the keyset compares `(updated_at, id)` against the cursor's position,
 * and the cursor's public id is resolved to its surrogate in the same statement.
 * Ordering on the surrogate rather than on the public id is what lets
 * `chat_session_user_recent_idx` satisfy the sort without a sort node, while the
 * cursor the client holds still names nothing internal.
 *
 * @param limit rows to return; one extra is read to decide whether more exist
 */
export async function listSessions(
  db: Db,
  userId: UserId,
  query: SessionListQuery,
): Promise<SessionPage> {
  const user = BigInt(userId);
  const cursor = query.cursor;
  const records = await db.chatSession.findMany({
    where: {
      userId: user,
      deletedAt: null,
      ...(cursor === undefined
        ? {}
        : {
            OR: [
              { updatedAt: { lt: cursor.updatedAt } },
              {
                updatedAt: cursor.updatedAt,
                id: { lt: await surrogateOf(db, user, cursor.id) },
              },
            ],
          }),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });

  const page = records.slice(0, query.limit);
  const last = page.at(-1);

  return {
    sessions: page.map(toRow),
    nextCursor:
      records.length > query.limit && last !== undefined
        ? { updatedAt: last.updatedAt, id: last.publicId }
        : undefined,
  };
}

async function surrogateOf(
  db: Db,
  userId: bigint,
  publicId: string,
): Promise<bigint> {
  const found = await db.chatSession.findFirst({
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
export async function attachmentCounts(
  db: Db,
  userId: UserId,
  sessionIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (sessionIds.length === 0) {
    return new Map();
  }

  const rows = await db.chatSession.findMany({
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
export async function softDeleteSession(
  db: Db,
  userId: UserId,
  sessionId: string,
): Promise<boolean> {
  const { count } = await db.chatSession.updateMany({
    where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
    data: { deletedAt: new Date() },
  });

  return count > 0;
}

export async function findSession(
  db: Db,
  userId: UserId,
  sessionId: string,
): Promise<SessionRow | undefined> {
  const found = await db.chatSession.findFirst({
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
export async function renameSession(
  db: Db,
  userId: UserId,
  sessionId: string,
  title: string,
): Promise<SessionRow | undefined> {
  const { count } = await db.chatSession.updateMany({
    where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
    data: { title },
  });

  return count === 0 ? undefined : findSession(db, userId, sessionId);
}
