import type { AttachmentId } from "@chat/contracts/attachment/attachment";
import type { PresignDisposition } from "@chat/contracts/attachment/presign";
import type { SessionId } from "@chat/contracts/chat/session";

/**
 * Guard: `sessionLists` is a prefix in its own right, not a convenience. The
 * page size is part of the list key, so a mutation that has to patch every
 * cached list cannot name them individually — it matches this prefix. Folding
 * the lists in beside `session` detail keys would make that match sweep the
 * detail caches too.
 */
export const chatKeys = {
  all: ["chat"] as const,
  sessions: () => [...chatKeys.all, "sessions"] as const,
  sessionLists: () => [...chatKeys.sessions(), "list"] as const,
  sessionList: (limit: number) => [...chatKeys.sessionLists(), { limit }] as const,
  session: (sessionId: SessionId) =>
    [...chatKeys.sessions(), "detail", sessionId] as const,
  attachments: (sessionId: SessionId) =>
    [...chatKeys.all, "attachments", sessionId] as const,
  attachmentUploads: (sessionId: SessionId) =>
    [...chatKeys.all, "attachment-upload", sessionId] as const,
  presign: (
    sessionId: SessionId,
    attachmentId: AttachmentId,
    disposition: PresignDisposition,
  ) =>
    [...chatKeys.all, "presign", sessionId, attachmentId, disposition] as const,
} as const;
