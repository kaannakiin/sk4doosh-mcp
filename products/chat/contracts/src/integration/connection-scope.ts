import { z } from "zod";

/**
 * Guard: a scope is an exact dotted token and there is no wildcard form.
 * `orders.*` would need a matcher at invoke time, and a matcher is where a
 * grant silently widens past what the user read on the consent screen.
 */
export const connectionScopeSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u);

export type ConnectionScope = z.infer<typeof connectionScopeSchema>;

export function isConnectionScope(value: unknown): value is ConnectionScope {
  return connectionScopeSchema.safeParse(value).success;
}
