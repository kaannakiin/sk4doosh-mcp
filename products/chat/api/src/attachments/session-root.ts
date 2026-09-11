import type { SessionId } from "@chat/contracts/chat/session";
import { join, resolve, sep } from "node:path";

export function sessionRootFor(uploadRoot: string, session: SessionId): string {
  return join(uploadRoot, session);
}

/**
 * Guard: refuses a resolved path that escapes `root`. Every path this service
 * builds is already safe by construction — the session id is parsed as a UUID
 * and the file name is generated, never taken from the upload — so this is the
 * assertion that keeps that property from silently lapsing if either input ever
 * starts coming from somewhere else.
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
