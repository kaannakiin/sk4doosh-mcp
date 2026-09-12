import type { Db } from "./client.js";
import { Prisma } from "./generated/client.js";
import type { MessageRole, MessageRow, TurnOutcome } from "./rows.js";

export interface MessageInput {
  readonly externalId: string;
  readonly seq: number;
  readonly role: MessageRole;
  readonly parts: readonly unknown[];
  readonly text: string;
}

export interface ReconcileParams {
  readonly ownerId: string;
  readonly sessionId: string;
  readonly messages: readonly MessageInput[];
  readonly title: string | null;
}

/**
 * Writes the history a turn posted, as the authoritative contents of a session.
 *
 * The client re-posts the whole conversation on every turn and on every tool
 * approval, so this is not "append the new messages" — it is "the posted history
 * is what the session holds now, positionally". Every case falls out of that: a
 * first turn inserts, an approval round-trip updates the same row because
 * `(session_id, external_id)` already names it, and a regeneration shortens the
 * list so the tail delete removes what the client dropped.
 *
 * @returns `false` when the session id belongs to somebody else
 */
export async function reconcileTurn(
  db: Db,
  params: ReconcileParams,
): Promise<boolean> {
  const owner = BigInt(params.ownerId);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`
      insert into chat_session (public_id, owner_id, title, created_at, updated_at)
      values (${params.sessionId}::uuid, ${owner}, ${params.title}, now(), now())
      on conflict (public_id) do nothing
    `;

    /**
     * Guard: this single statement is the ownership check and the per-session
     * write lock at once. Without `for update` two concurrent turns on one
     * session interleave their reconciles and the seq numbering of the loser is
     * silently overwritten; without the `owner_id` predicate a guessed session id
     * would be enough to write into somebody else's conversation.
     */
    const locked = await tx.$queryRaw<{ id: bigint }[]>`
      select id from chat_session
      where public_id = ${params.sessionId}::uuid
        and owner_id = ${owner}
        and deleted_at is null
      for update
    `;
    const session = locked[0];
    if (session === undefined) {
      return false;
    }

    if (params.messages.length > 0) {
      const payload = JSON.stringify(
        params.messages.map((message) => ({
          external_id: message.externalId,
          seq: message.seq,
          role: message.role,
          parts: message.parts,
          text: message.text,
        })),
      );

      /**
       * Guard: one statement regardless of history length, and the `where` on the
       * conflict branch makes an unchanged row a true no-op — no write, no WAL, no
       * dead tuple. Without it every turn rewrites the entire conversation, which
       * is what makes "the posted history is authoritative" affordable at all.
       * Prisma's `upsert` cannot express `on conflict do update ... where`, and a
       * per-message loop would be one round trip per message on the hot path.
       */
      await tx.$executeRaw`
        insert into chat_message (session_id, external_id, seq, role, parts, text)
        select ${session.id}, m.external_id, m.seq, m.role::"MessageRole", m.parts, m.text
          from jsonb_to_recordset(${payload}::jsonb)
            as m(external_id text, seq int, role text, parts jsonb, text text)
        on conflict (session_id, external_id) do update
           set seq = excluded.seq,
               role = excluded.role,
               parts = excluded.parts,
               text = excluded.text,
               updated_at = now()
         where chat_message.seq <> excluded.seq
            or chat_message.parts <> excluded.parts
      `;
    }

    /**
     * Guard: everything the posted history does not contain is removed, not just
     * the tail past its length. A regeneration can replace a turn in place with a
     * different message id, which leaves the old row at the same seq — dropping
     * only the tail would keep it, and the next read would hand the model two
     * answers to one question.
     */
    const keep = params.messages.map((message) => message.externalId);
    await (keep.length === 0
      ? tx.$executeRaw`delete from chat_message where session_id = ${session.id}`
      : tx.$executeRaw`
          delete from chat_message
          where session_id = ${session.id}
            and external_id <> all(${keep}::text[])
        `);

    await tx.$executeRaw`
      update chat_session
         set updated_at = now(),
             message_count = ${params.messages.length},
             title = coalesce(title, ${params.title})
       where id = ${session.id}
    `;

    return true;
  });
}

/**
 * Records how a turn ended, on the assistant message it produced.
 *
 * Guard: the owner is matched here and not only by the caller. `reconcileTurn`
 * already refuses a session another owner holds, and today this runs behind that
 * refusal — but the check belongs to the statement, because this function is
 * exported and the next caller inherits no such gate. The predicate also closes
 * a window the caller cannot: the two run in separate transactions, so a session
 * soft deleted in between would still take this write without `deleted_at`.
 */
export async function settleTurn(
  db: Db,
  ownerId: string,
  sessionId: string,
  externalId: string,
  outcome: TurnOutcome,
  finishReason: string | undefined,
): Promise<void> {
  await db.$executeRaw`
    update chat_message
       set outcome = ${outcome}::"TurnOutcome",
           finish_reason = ${finishReason ?? null},
           updated_at = now()
     where external_id = ${externalId}
       and session_id = (select id from chat_session
                          where public_id = ${sessionId}::uuid
                            and owner_id = ${BigInt(ownerId)}
                            and deleted_at is null)
  `;
}

/**
 * The newest slice of a conversation, oldest first.
 *
 * @param limit how many turns to read back
 * @returns the messages and whether older ones were left behind
 */
export async function listMessages(
  db: Db,
  ownerId: string,
  sessionId: string,
  limit: number,
): Promise<{ messages: MessageRow[]; truncated: boolean }> {
  const session = await db.chatSession.findFirst({
    where: { publicId: sessionId, ownerId: BigInt(ownerId), deletedAt: null },
    select: { id: true },
  });
  if (session === null) {
    return { messages: [], truncated: false };
  }

  const total = await db.chatMessage.count({
    where: { sessionId: session.id },
  });
  const rows = await db.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { seq: "desc" },
    take: limit,
  });

  return {
    messages: rows.reverse().map((row) => ({
      externalId: row.externalId,
      seq: row.seq,
      role: row.role,
      parts: asParts(row.parts),
      text: row.text,
      outcome: row.outcome,
      createdAt: row.createdAt,
    })),
    truncated: total > rows.length,
  };
}

/**
 * Guard: `parts` is written as a json array and read back as `JsonValue`. A row
 * edited by hand, or written by an older shape, can be any json at all — handing
 * a non-array to `validateUIMessages` throws inside the stream instead of
 * degrading, so the shape is narrowed here and an unusable row reads as empty.
 */
function asParts(value: Prisma.JsonValue): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
