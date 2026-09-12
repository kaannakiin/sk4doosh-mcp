import { z } from "zod";

import { sessionIdSchema } from "./session.ts";

const CURSOR_MAX_CHARS = 512;

/**
 * Guard: the session list cursor is a keyset, not an offset. The list is ordered
 * by `updatedAt` descending and any turn in any session rewrites that session's
 * `updatedAt`, so an offset page skips or repeats rows whenever the visitor is
 * still chatting while paging. Both halves are carried because `updatedAt` is not
 * unique, and the tiebreaker is the public id rather than the table's surrogate —
 * a surrogate inside a base64 string is still readable, and would leak how many
 * sessions exist across every owner.
 */
export const sessionCursorSchema = z.object({
  updatedAt: z.iso.datetime(),
  id: sessionIdSchema,
});

export type SessionCursor = z.infer<typeof sessionCursorSchema>;

/**
 * Guard: base64url is built from `TextEncoder` and `btoa` rather than from
 * `Buffer`. This package is compiled into the browser bundle, so it carries no
 * node types and must reach for no node globals — a `Buffer` here fails to
 * compile and, if it did compile, would need a polyfill at runtime.
 */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(token: string): string {
  const padded = token
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(token.length / 4) * 4, "=");

  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
  );
}

export function encodeSessionCursor(cursor: SessionCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

/**
 * Reads a cursor a previous page produced.
 *
 * Guard: the shape is checked before the decode, and every failure returns
 * `undefined` rather than throwing. A cursor is attacker-supplied text, and a
 * stale or hand-edited one should restart the listing, not fail the request.
 *
 * @returns the cursor, or `undefined` when the token is not one this server made
 */
export function decodeSessionCursor(raw: string): SessionCursor | undefined {
  if (raw.length > CURSOR_MAX_CHARS || !/^[A-Za-z0-9_-]+$/u.test(raw)) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(fromBase64Url(raw));

    return sessionCursorSchema.safeParse(parsed).data;
  } catch {
    return undefined;
  }
}
