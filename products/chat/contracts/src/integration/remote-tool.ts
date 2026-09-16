import { z } from "zod";

import { remoteToolNameSchema } from "./remote-tool-name.ts";
import { toolAnnotationsSchema } from "./tool-annotations.ts";

/**
 * A tool as the remote server described it.
 *
 * Guard: `inputSchema` is `z.looseObject({})` rather than a JSON Schema model.
 * The document is written by a server this platform has not met and is stored
 * and forwarded without being understood; narrowing it here would make a server
 * that publishes a valid schema this product does not model disappear from the
 * list with no error to read.
 */
export const remoteToolSchema = z.object({
  name: remoteToolNameSchema,
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(8192).optional(),
  inputSchema: z.looseObject({}),
  annotations: toolAnnotationsSchema.optional(),
});

export type RemoteTool = z.infer<typeof remoteToolSchema>;
