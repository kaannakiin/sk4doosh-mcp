const SESSION_KEY = "chat_session";

/**
 * Guard: read only from `sessionStorage`, and only on the client. The id names
 * the server-side sandbox directory the uploaded files live in, so it has to
 * survive a reload — but it must not outlive the tab, because the files behind
 * it are reaped on a TTL and a restored id would point at an empty sandbox.
 */
export function resolveSessionId(): string {
  try {
    const stored = window.sessionStorage.getItem(SESSION_KEY);
    if (stored !== null && stored.length > 0) {
      return stored;
    }

    const created = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, created);

    return created;
  } catch {
    return crypto.randomUUID();
  }
}
