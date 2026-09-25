const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${name}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

/**
 * Guard: the cookie is split rather than matched with a RegExp. `document.cookie`
 * is one long attacker-influenceable string — any site-set cookie lands in it —
 * and a pattern with a leading alternation over it is the classic backtracking
 * shape.
 */
export function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  for (const entry of document.cookie.split(";")) {
    const separator = entry.indexOf("=");
    if (separator > 0 && entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim();
    }
  }

  return undefined;
}
