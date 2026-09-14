/**
 * Narrows an untrusted string to an in-app destination.
 *
 * Guard: no regex, and the second character is the whole check. A
 * protocol-relative `//evil.example` is a valid *path* to `startsWith("/")` and a
 * valid *absolute url* to the browser, so it turns the post-sign-in redirect into
 * an open one. `/\evil.example` is the same attack with the slash Windows
 * normalises, and a control character smuggles a second header line.
 *
 * @returns the path, or `undefined` when it does not lead back into this app
 */
export function internalHref(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return undefined;
  }
  for (const character of raw) {
    if (character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f) {
      return undefined;
    }
  }

  return raw;
}
