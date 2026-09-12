/**
 * Guard: relative specifiers in this package are written `./foo.js`, not
 * `./foo.ts` as in `@chat/api` and `@chat/contracts`. The Prisma generator emits
 * `.js` specifiers into `.ts` files (`importFileExtension = "js"`), which
 * NodeNext resolves by substitution and emits verbatim, so this package must not
 * set `allowImportingTsExtensions` or `rewriteRelativeImportExtensions`. Writing
 * `./foo.ts` here fails to compile; the divergence is deliberate, not an
 * oversight.
 */
export { createDb } from "./client.js";
export {
  createAttachment,
  familiesFor,
  findAttachment,
  findBySandboxPath,
  listAttachments,
  sessionUsage,
  softDeleteAttachment,
} from "./attachments.js";
export type {
  AttachmentOutcome,
  AttachmentRefusal,
  NewAttachment,
} from "./attachments.js";
export { createOwner, resolveOwner } from "./owners.js";
export { listMessages, reconcileTurn, settleTurn } from "./messages.js";
export type { MessageInput, ReconcileParams } from "./messages.js";
export {
  attachmentCounts,
  findSession,
  listSessions,
  renameSession,
  softDeleteSession,
} from "./sessions.js";
export type { SessionListQuery } from "./sessions.js";
export type { Db, DbOptions } from "./client.js";
export type {
  AttachmentRow,
  MessageRole,
  MessageRow,
  OwnerRow,
  ReaderFamily,
  SessionPage,
  SessionRow,
  SessionUsage,
  TurnOutcome,
} from "./rows.js";
