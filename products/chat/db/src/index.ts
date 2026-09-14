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
export { isUniqueConstraintError } from "./errors.js";
export type { Db, DbOptions } from "./client.js";
export type {
  AttachmentRow,
  MessageRole,
  MessageRow,
  ReaderFamily,
  SessionPage,
  SessionRow,
  SessionUsage,
  TurnOutcome,
} from "./rows.js";
