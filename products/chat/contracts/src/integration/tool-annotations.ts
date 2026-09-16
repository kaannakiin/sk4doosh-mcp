import { z } from "zod";

/**
 * What a server claims about one of its tools.
 *
 * Guard: `looseObject` for the same reason `inputSchema` is one — a server this
 * platform has not met wrote the document, and narrowing it here would drop a
 * conforming server's hints with no error to read.
 */
export const toolAnnotationsSchema = z.looseObject({
  title: z.string().max(200).optional(),
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});

export type ToolAnnotations = z.infer<typeof toolAnnotationsSchema>;

/**
 * Whether the server declared this tool able to change or destroy data.
 *
 * Guard: consumed in one direction only. An explicit `true` raises the bar — the
 * tool asks on every call and no remembered approval silences it — while
 * `readOnlyHint` never lowers it. A server that lies can make itself more
 * tiresome and nothing else.
 *
 * Guard: absence is not a claim. MCP's own default for `destructiveHint` is
 * `true`, but reading an absent annotation as destructive would mark every tool
 * of every server that publishes no annotations — the common case — and the
 * remembered approval would never once be honoured.
 *
 * @param annotations what the server published, if anything
 * @returns whether the server said so in as many words
 */
export function isDeclaredDestructive(
  annotations: ToolAnnotations | undefined,
): boolean {
  return annotations?.destructiveHint === true;
}
