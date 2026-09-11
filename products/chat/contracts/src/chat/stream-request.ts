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
});

export type StreamRequest = z.infer<typeof streamRequestSchema>;
