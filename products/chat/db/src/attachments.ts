import type { Db } from "./client.js";
import type { AttachmentRow, ReaderFamily, SessionUsage } from "./rows.js";

type AttachmentRecord = {
  publicId: string;
  filename: string;
  mediaType: string;
  family: ReaderFamily | null;
  sandboxPath: string | null;
  objectKey: string;
  bytes: number;
  checksum: Uint8Array;
  createdAt: Date;
};

function toRow(record: AttachmentRecord, sessionId: string): AttachmentRow {
  return {
    id: record.publicId,
    sessionId,
    filename: record.filename,
    mediaType: record.mediaType,
    family: record.family,
    sandboxPath: record.sandboxPath,
    objectKey: record.objectKey,
    bytes: record.bytes,
    checksum: Buffer.from(record.checksum).toString("hex"),
    createdAt: record.createdAt,
  };
}

const live = (ownerId: string, sessionId: string) => ({
  deletedAt: null,
  session: { publicId: sessionId, ownerId: BigInt(ownerId), deletedAt: null },
});

export async function listAttachments(
  db: Db,
  ownerId: string,
  sessionId: string,
): Promise<AttachmentRow[]> {
  const rows = await db.chatAttachment.findMany({
    where: live(ownerId, sessionId),
    orderBy: { id: "asc" },
  });

  return rows.map((row) => toRow(row, sessionId));
}

export async function findAttachment(
  db: Db,
  ownerId: string,
  sessionId: string,
  attachmentId: string,
): Promise<AttachmentRow | undefined> {
  const row = await db.chatAttachment.findFirst({
    where: { publicId: attachmentId, ...live(ownerId, sessionId) },
  });

  return row === null ? undefined : toRow(row, sessionId);
}

/**
 * Resolves the path the model named back to its row.
 *
 * Guard: the reader tools take a `sandbox_path`, not an id, so this is the
 * lookup the materializer needs. It is session scoped, which is what stops a
 * model that replays another conversation's filename from reaching its bytes.
 */
export async function findBySandboxPath(
  db: Db,
  ownerId: string,
  sessionId: string,
  sandboxPath: string,
): Promise<AttachmentRow | undefined> {
  const row = await db.chatAttachment.findFirst({
    where: { sandboxPath, ...live(ownerId, sessionId) },
  });

  return row === null ? undefined : toRow(row, sessionId);
}

export async function familiesFor(
  db: Db,
  ownerId: string,
  sessionId: string,
): Promise<ReaderFamily[]> {
  const rows = await db.chatAttachment.findMany({
    where: { ...live(ownerId, sessionId), family: { not: null } },
    distinct: ["family"],
    select: { family: true },
  });

  return rows.flatMap((row) => (row.family === null ? [] : [row.family]));
}

export async function sessionUsage(
  db: Db,
  ownerId: string,
  sessionId: string,
): Promise<SessionUsage> {
  const totals = await db.chatAttachment.aggregate({
    where: live(ownerId, sessionId),
    _count: true,
    _sum: { bytes: true },
  });

  return { files: totals._count, bytes: totals._sum.bytes ?? 0 };
}

export interface NewAttachment {
  readonly ownerId: string;
  readonly sessionId: string;
  readonly attachmentId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly family: ReaderFamily | null;
  readonly sandboxPath: string | null;
  readonly objectKey: string;
  readonly bytes: number;
  readonly checksum: string;
  readonly maxFiles: number;
  readonly maxBytes: number;
}

export type AttachmentRefusal =
  "session_not_found" | "too_many_files" | "session_budget_exceeded";

export type AttachmentOutcome =
  | {
      readonly ok: true;
      readonly row: AttachmentRow;
      readonly usage: SessionUsage;
    }
  | { readonly ok: false; readonly reason: AttachmentRefusal };

/**
 * Records an attachment whose bytes are already in the object store.
 *
 * Guard: the quota is read inside the same transaction that holds the session's
 * row lock. Without the lock two simultaneous uploads each read the same total
 * and both pass, so a session overshoots its budget by a file; and without
 * reading it from the database at all the count is per-process, resets on
 * restart while the objects persist, and is wrong the moment a second instance
 * exists.
 */
export async function createAttachment(
  db: Db,
  attachment: NewAttachment,
): Promise<AttachmentOutcome> {
  const owner = BigInt(attachment.ownerId);

  return db.$transaction(async (tx) => {
    /**
     * Guard: the session is created here when it does not exist yet. Attaching a
     * file is how a conversation usually starts — the interface asks for one
     * before it lets the visitor type — so requiring a prior turn would make the
     * first upload of every session fail.
     */
    await tx.$executeRaw`
      insert into chat_session (public_id, owner_id, created_at, updated_at)
      values (${attachment.sessionId}::uuid, ${owner}, now(), now())
      on conflict (public_id) do nothing
    `;

    const locked = await tx.$queryRaw<{ id: bigint }[]>`
      select id from chat_session
      where public_id = ${attachment.sessionId}::uuid
        and owner_id = ${owner}
        and deleted_at is null
      for update
    `;
    const session = locked[0];
    if (session === undefined) {
      return { ok: false, reason: "session_not_found" };
    }

    const totals = await tx.chatAttachment.aggregate({
      where: { sessionId: session.id, deletedAt: null },
      _count: true,
      _sum: { bytes: true },
    });
    const used = totals._sum.bytes ?? 0;
    if (totals._count >= attachment.maxFiles) {
      return { ok: false, reason: "too_many_files" };
    }
    if (used + attachment.bytes > attachment.maxBytes) {
      return { ok: false, reason: "session_budget_exceeded" };
    }

    const created = await tx.chatAttachment.create({
      data: {
        publicId: attachment.attachmentId,
        sessionId: session.id,
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        family: attachment.family,
        sandboxPath: attachment.sandboxPath,
        objectKey: attachment.objectKey,
        bytes: attachment.bytes,
        checksum: Buffer.from(attachment.checksum, "hex"),
      },
    });

    return {
      ok: true,
      row: toRow(created, attachment.sessionId),
      usage: {
        files: totals._count + 1,
        bytes: used + attachment.bytes,
      },
    };
  });
}

/**
 * Tombstones an attachment and hands back what it pointed at.
 *
 * Guard: the row goes first and the object second. The reverse order manufactures
 * the unsafe orphan — a row naming bytes that are gone, which the manifest then
 * offers the model as a readable file. Removing the row first also closes the
 * race: once it is gone nothing can materialize the attachment between the two
 * deletions.
 */
export async function softDeleteAttachment(
  db: Db,
  ownerId: string,
  sessionId: string,
  attachmentId: string,
): Promise<AttachmentRow | undefined> {
  const found = await findAttachment(db, ownerId, sessionId, attachmentId);
  if (found === undefined) {
    return undefined;
  }

  const { count } = await db.chatAttachment.updateMany({
    where: { publicId: attachmentId, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  return count > 0 ? found : undefined;
}
