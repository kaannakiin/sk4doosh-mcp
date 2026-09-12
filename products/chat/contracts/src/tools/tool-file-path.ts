import { z } from "zod";

/**
 * The one field every reader tool's input carries.
 *
 * Guard: read defensively rather than assumed. Every reader tool requires a
 * `filePath` today, and this shape is parsed with `safeParse` so a future tool
 * without one passes through untouched instead of failing every call.
 */
export const toolFilePathSchema = z.object({
  filePath: z.string().min(1),
});

export type ToolFilePath = z.infer<typeof toolFilePathSchema>;
