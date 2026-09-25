import { z } from "zod";

import { sessionSummarySchema } from "./session-record.ts";
import {
  SESSION_PAGE_SIZE_DEFAULT,
  SESSION_PAGE_SIZE_HARD,
} from "./session-limits.ts";

export const sessionListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SESSION_PAGE_SIZE_HARD)
    .default(SESSION_PAGE_SIZE_DEFAULT),
});

export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;

/**
 * Guard: `pinned` rides on the first page only, and `sessions` never repeats a
 * pinned row. Pins are few and capped, so one list is cheaper than a second
 * endpoint, and keeping them out of the keyset keeps its pages stable when a
 * row is pinned or unpinned.
 */
export const sessionListResponseSchema = z.object({
  pinned: z.array(sessionSummarySchema).optional(),
  sessions: z.array(sessionSummarySchema),
  nextCursor: z.string().optional(),
});

export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
