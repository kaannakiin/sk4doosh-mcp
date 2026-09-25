import { z } from "zod";

export const callToolInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .describe("A tool name exactly as find_tools returned it."),
  arguments: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Arguments matching that tool's input schema."),
});

export type CallToolInput = z.infer<typeof callToolInputSchema>;
