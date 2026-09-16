import { z } from "zod";

/**
 * Guard: the result ceiling is the product's, not the caller's. The model picks
 * the query; letting it pick the width too is how a single search puts every
 * tool of every connected server back into the prompt, which is the cost this
 * tool exists to avoid.
 */
export const findToolsInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
});

export type FindToolsInput = z.infer<typeof findToolsInputSchema>;
