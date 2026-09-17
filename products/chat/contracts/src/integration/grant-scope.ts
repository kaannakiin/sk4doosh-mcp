import { z } from "zod";

/**
 * How far a remembered approval reaches.
 *
 * Guard: `session` is the narrow one and it is what the prompt offers first. A
 * grant that covers every future conversation is the widest thing this product
 * lets a reader give, and it used to be the only thing on offer — a single
 * checkbox that meant forever and everywhere.
 */
export const grantScopeSchema = z.enum(["session", "global"]);

export type GrantScope = z.infer<typeof grantScopeSchema>;

export function isGrantScope(value: unknown): value is GrantScope {
  return grantScopeSchema.safeParse(value).success;
}

/**
 * How long a new grant stays live.
 *
 * Guard: a reader preference, not a per-decision choice. Three controls on an
 * approval card is a card nobody reads; the scope is the decision, the duration
 * is a setting the decision inherits.
 *
 * Guard: there is no `session` duration, because that would be a second way to
 * spell the `session` scope — and the two could then be combined into a grant
 * that reaches every conversation but dies with one of them, which is not a
 * thing. Duration applies the same way whatever the scope is.
 */
export const grantTtlSchema = z.enum(["day", "week", "never"]);

export type GrantTtl = z.infer<typeof grantTtlSchema>;

export function isGrantTtl(value: unknown): value is GrantTtl {
  return grantTtlSchema.safeParse(value).success;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const TTL_MS: Record<GrantTtl, number | undefined> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  never: undefined,
};

/**
 * When a grant written now stops being honoured.
 *
 * Guard: materialized at grant time rather than read at decision time. Changing
 * the preference must not reach back and widen consent that was already given,
 * and computing the expiry on every call would do exactly that.
 *
 * @param ttl the reader's preference
 * @param now when the grant is being written
 * @returns the moment it lapses, or `undefined` for never
 */
export function grantExpiryFor(ttl: GrantTtl, now: Date): Date | undefined {
  const span = TTL_MS[ttl];

  return span === undefined ? undefined : new Date(now.getTime() + span);
}
