/**
 * Matches a route template against a host-written pattern: `*` within one segment, `**` across.
 *
 * @param pattern - The host's pattern, matched whole; `**` is the catch-all, `*` is not.
 * @param route - A composed route template, as `EndpointDescriptor.route` carries it.
 * @returns Whether the pattern matches the whole route.
 */
export function matchesRoute(pattern: string, route: string): boolean {
  /**
   * Every regex metacharacter outside the two wildcards is escaped before it can turn a
   * host-written pattern into a catastrophic backtracker. Route templates carry `{id}`
   * placeholders, so the braces reach this escape on every ordinary pattern.
   */
  const source = pattern
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${source}$`).test(route);
}
