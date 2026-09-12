/**
 * The rows this package hands to its consumers.
 *
 * Guard: these are hand written and every exported function's signature
 * references only them, never a generated model. That is what keeps
 * `dist/index.d.ts` self contained, so `@chat/api` never opens a generated
 * declaration file, and what makes a later swap to hand written SQL a change
 * confined to this package.
 *
 * Guard: every `id` here is a public identifier, never the `BigInt` surrogate
 * the tables key on. Prisma maps `BigInt` to a JavaScript `bigint`, and
 * `JSON.stringify` throws on one — a surrogate that reached a response body
 * would turn a successful query into a 500. Keeping them out of these
 * interfaces makes that unrepresentable rather than merely discouraged.
 */
import type { ReaderFamily } from "@chat/contracts/attachment/media-type";
import type { MessageRole } from "@chat/contracts/chat/message";
import type {
  MessageRole as SchemaMessageRole,
  ReaderFamily as SchemaReaderFamily,
  TurnOutcome as SchemaTurnOutcome,
} from "./generated/enums.js";

export type { MessageRole, ReaderFamily };

export type TurnOutcome = "completed" | "failed" | "aborted" | "unknown";

/**
 * Guard: the enums the wire speaks are declared once, in `@chat/contracts`, and
 * `EnumParity` is the proof that the Postgres enums still say exactly the same
 * thing. Without it the two drift in silence and the failure arrives as
 * `invalid input value for enum` on the first row that carries the new value —
 * at insert time, in production. `Assert` turns that into a compile error naming
 * the enum that moved.
 *
 * Guard: the dependency runs server to browser and never the other way. Prisma
 * generates a browser entry, but importing it from `@chat/contracts` would put
 * `@chat/db#gen` on `@chat/web`'s build path and retire the module resolution
 * barrier that is the first of the three layers keeping Prisma out of the
 * bundle. `TurnOutcome` is declared here rather than in contracts because it
 * never leaves this process.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Assert<T extends true> = T;

export type EnumParity =
  | Assert<Exact<MessageRole, SchemaMessageRole>>
  | Assert<Exact<ReaderFamily, SchemaReaderFamily>>
  | Assert<Exact<TurnOutcome, SchemaTurnOutcome>>;

export interface OwnerRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
}

export interface SessionRow {
  readonly id: string;
  readonly title: string | null;
  readonly messageCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MessageRow {
  readonly externalId: string;
  readonly seq: number;
  readonly role: MessageRole;
  readonly parts: readonly unknown[];
  readonly text: string;
  readonly outcome: TurnOutcome;
  readonly createdAt: Date;
}

export interface AttachmentRow {
  readonly id: string;
  readonly sessionId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly family: ReaderFamily | null;
  readonly sandboxPath: string | null;
  readonly objectKey: string;
  readonly bytes: number;
  readonly checksum: string;
  readonly createdAt: Date;
}

export interface SessionUsage {
  readonly files: number;
  readonly bytes: number;
}

/**
 * A page of sessions ordered newest first.
 *
 * Guard: the cursor carries `updatedAt` plus the session's public id, never the
 * `BigInt` surrogate. A surrogate in an opaque-looking cursor is still base64,
 * so it would leak how many sessions exist across every owner.
 */
export interface SessionPage {
  readonly sessions: readonly SessionRow[];
  readonly nextCursor:
    { readonly updatedAt: Date; readonly id: string } | undefined;
}
