import { z } from "zod";

/**
 * The name a remote tool is offered to the model under.
 *
 * Guard: this is the shape a provider accepts, not the shape MCP allows. A
 * remote tool name may run to 128 characters and carry dots, while a provider's
 * tool name is commonly `^[a-zA-Z0-9_-]{1,64}$` — a name forwarded unchanged
 * fails the whole request, killing every tool in the turn rather than one.
 *
 * Guard: the prefix is part of the name because two servers may both offer
 * `search`. It is derived from the integration's public id, never from its
 * display name: a rename would otherwise change every exposed name and orphan
 * every tool call already written into a conversation's history.
 */
export const exposedToolNameSchema = z.string().regex(/^[a-z0-9_]{1,64}$/u);

export type ExposedToolName = z.infer<typeof exposedToolNameSchema>;

export function isExposedToolName(value: unknown): value is ExposedToolName {
  return exposedToolNameSchema.safeParse(value).success;
}
