import { z } from "zod";

import { sessionIdSchema } from "./session.ts";

export const sessionSummarySchema = z.object({
  id: sessionIdSchema,
  title: z.string().nullable(),
  messageCount: z.int().nonnegative(),
  attachmentCount: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;
