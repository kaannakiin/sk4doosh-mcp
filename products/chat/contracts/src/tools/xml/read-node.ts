import { z } from "zod";

import { addressSchema, documentPathSchema, XML_MAX_DEPTH } from "./shared.ts";

export const READ_NODE_MAX_NODES = 200;

export const readNodeInputSchema = z.object({
  filePath: documentPathSchema,
  address: addressSchema.optional(),
  maxDepth: z
    .int()
    .min(0)
    .max(XML_MAX_DEPTH)
    .optional()
    .describe("Depth below the addressed element to include."),
  maxNodes: z
    .int()
    .min(1)
    .max(READ_NODE_MAX_NODES)
    .default(50)
    .describe("Maximum records in one page."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque token from a previous read_node response."),
});

export type ReadNodeInput = z.infer<typeof readNodeInputSchema>;
