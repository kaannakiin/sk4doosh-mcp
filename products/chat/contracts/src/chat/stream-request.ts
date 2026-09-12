import { z } from "zod";

import { sessionIdSchema } from "./session.ts";

/**
 * The chat turn envelope. `messages` stays `unknown` on purpose: the UI message
 * part shape belongs to the AI SDK, which validates it with `validateUIMessages`
 * once the envelope has been accepted. Re-declaring those parts here would fork
 * a copy of the SDK's stream contract that drifts on every SDK upgrade.
 */
export const streamRequestSchema = z.object({
  id: z.string().min(1),
  sessionId: sessionIdSchema,
  messages: z.array(z.unknown()).min(1),
  /**
   * Guard: `id` is the AI SDK chat id, which this client sets to the session id —
   * it is not a per-turn identifier and must never be used as one. `trigger` and
   * `messageId` are what the SDK's transport already sends and what actually
   * distinguishes a new user turn from a regeneration; dropping them here is what
   * left the server unable to tell the two apart.
   */
  trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
  messageId: z.string().min(1).optional(),
});

export type StreamRequest = z.infer<typeof streamRequestSchema>;
