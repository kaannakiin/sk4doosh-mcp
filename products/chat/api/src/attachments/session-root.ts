import type { SessionId } from "@chat/contracts/chat/session";
import { join, resolve, sep } from "node:path";

/**
 * The directory a reader process is rooted at.
 *
 * Guard: `.staging/` is a sibling of this directory, never inside it. Downloads
 * land there and are renamed in, so a reader can only ever observe a file as
 * absent or as complete and verified. A partial file inside the pinned root
 * would be reachable by the reader's own name-miss fallback scan — rejected on
 * extension, so harmless, but "harmless partial file in the sandbox" is a
 * property somebody has to re-derive every time they touch the reader, and
 * "never a partial file in the sandbox" is one nobody has to think about.
 */
export function readableRootFor(cacheRoot: string, session: SessionId): string {
  return join(cacheRoot, session, "readable");
}

export function stagingRootFor(cacheRoot: string, session: SessionId): string {
  return join(cacheRoot, session, ".staging");
}

export function sessionCacheRootFor(
  cacheRoot: string,
  session: SessionId,
): string {
  return join(cacheRoot, session);
}

/**
 * Guard: refuses a resolved path that escapes `root`. This used to be a backstop
 * for paths that were safe by construction — the session id parsed as a uuid, the
 * file name generated two statements above the write. That is no longer true:
 * `sandbox_path` is now read back from Postgres, so it is untrusted input, and
 * "it did not come from the request" is not "it is trusted". A bad migration, a
 * manual update or a future bulk import can put anything in that column, and the
 * materializer writes files as the api user. This runs together with
 * `sandboxPathSchema`, both before a file is opened.
 */
export function isContained(root: string, candidate: string): boolean {
  const base = resolve(root);
  const target = resolve(candidate);

  return target === base || target.startsWith(`${base}${sep}`);
}

const TURKISH_FOLD = new Map([
  ["ı", "i"],
  ["İ", "i"],
  ["ş", "s"],
  ["Ş", "s"],
  ["ğ", "g"],
  ["Ğ", "g"],
  ["ç", "c"],
  ["Ç", "c"],
  ["ö", "o"],
  ["Ö", "o"],
  ["ü", "u"],
  ["Ü", "u"],
]);

/**
 * Guard: folds Turkish letters through an explicit map before ASCII-lowering.
 * `"İ".toLowerCase()` yields a two-code-point sequence and `"I".toLowerCase()`
 * yields the dotless `ı` under a Turkish locale, so a plain lowercase leaves
 * bytes in a name that is supposed to be ASCII-only. Same trap the spec side
 * documents in `packages/xml-mcp/src/text.ts`.
 */
function fold(value: string): string {
  let folded = "";
  for (const character of value.normalize("NFC")) {
    folded += TURKISH_FOLD.get(character) ?? character;
  }

  return folded.toLowerCase();
}

const SLUG_MAX_LENGTH = 48;

function slug(value: string): string {
  const cleaned = fold(value)
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/u, "");

  return cleaned.length > 0 ? cleaned : "file";
}

/**
 * Builds the on-disk name for an attachment: a slug of the uploaded name for
 * readability, the attachment id for uniqueness, and the extension the reader
 * dispatches on. The uploaded name never reaches the filesystem verbatim.
 */
export function sandboxFileName(
  originalName: string,
  attachmentId: string,
  extension: string,
): string {
  const stem = originalName.replace(/\.[^./\\]*$/u, "");

  return `${slug(stem)}-${attachmentId.slice(0, 8)}.${extension}`;
}
