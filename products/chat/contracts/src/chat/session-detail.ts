import { z } from "zod";

import { attachmentSchema } from "../attachment/attachment.ts";
import { storedMessageSchema } from "./message.ts";
import { sessionSummarySchema } from "./session-record.ts";

/**
 * Everything the client needs to reopen a conversation.
 *
 * `truncated` says the history was cut to the newest slice, so the UI can tell
 * the visitor that older turns exist but are not in the window.
 */
export const sessionDetailResponseSchema = z.object({
  session: sessionSummarySchema,
  messages: z.array(storedMessageSchema),
  attachments: z.array(attachmentSchema),
  truncated: z.boolean(),
});

export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>;
