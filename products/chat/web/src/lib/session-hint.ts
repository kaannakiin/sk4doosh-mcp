const SESSION_HINT_COOKIE = "chat_session";

/**
 * Says whether a session probably exists, from a cookie that carries no secret.
 *
 * Guard: split on ";" rather than matched with a regex, for the same reason the
 * locale cookie is read that way — `document.cookie` is attacker-influenceable
 * and a backtracking pattern over it is a denial of service the page inflicts on
 * itself.
 *
 * Guard: "probably". The marker outlives nothing and proves nothing; it only
 * keeps the sign-in page from spending the shared refresh rate limit on visitors
 * who have never signed in.
 */
export function hasSessionHint(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  for (const pair of document.cookie.split(";")) {
    const trimmed = pair.trim();
    const separator = trimmed.indexOf("=");
    if (separator > 0 && trimmed.slice(0, separator) === SESSION_HINT_COOKIE) {
      return true;
    }
  }

  return false;
}
