import { z } from "zod";

import { SESSION_TITLE_MAX_LENGTH } from "./session-limits.ts";

/**
 * Guard: the title is trimmed before it is measured, so whitespace can neither
 * pass the minimum nor inflate a title past the column's width.
 */
export const sessionRenameSchema = z.object({
  title: z.string().trim().min(1).max(SESSION_TITLE_MAX_LENGTH),
});

export type SessionRename = z.infer<typeof sessionRenameSchema>;
