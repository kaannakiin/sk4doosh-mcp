/**
 * Guard: query strings are built by hand rather than with `URLSearchParams`.
 * React Native's polyfill of it is partial and has historically dropped or
 * mis-encoded parameters, and this package has to resolve identically under
 * Metro and a browser bundler.
 */
export function withQuery(
  path: string,
  params: Readonly<Record<string, string | number | undefined>>,
): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      pairs.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    }
  }

  return pairs.length === 0 ? path : `${path}?${pairs.join("&")}`;
}

export function sessionPath(sessionId: string, suffix = ""): string {
  return `/chat/sessions/${encodeURIComponent(sessionId)}${suffix}`;
}

export function attachmentPath(attachmentId: string, suffix = ""): string {
  return `/chat/files/${encodeURIComponent(attachmentId)}${suffix}`;
}
