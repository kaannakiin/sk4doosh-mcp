import { z } from "zod";

export const messageRoleSchema = z.enum(["user", "assistant"]);

export type MessageRole = z.infer<typeof messageRoleSchema>;

/**
 * One stored turn.
 *
 * Guard: `parts` stays `unknown` for the same reason `streamRequestSchema`'s
 * `messages` does — the UI message part union belongs to the AI SDK, which
 * re-validates it with `validateUIMessages` on the way out of the database.
 * Re-declaring it here would fork a copy of the SDK's stream contract that drifts
 * on every upgrade, and would pull `ai` into the browser bundle.
 *
 * Guard: `id` is the SDK's message id, not a uuid. Its own generator emits it,
 * and it is what makes a re-sent history idempotent — the client posts the whole
 * conversation again on every turn and on every tool approval.
 */
export const storedMessageSchema = z.object({
  id: z.string().min(1),
  role: messageRoleSchema,
  parts: z.array(z.unknown()).min(1),
  createdAt: z.iso.datetime(),
});

export type StoredMessage = z.infer<typeof storedMessageSchema>;
