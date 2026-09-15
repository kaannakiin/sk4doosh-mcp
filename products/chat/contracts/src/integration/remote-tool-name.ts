import { z } from "zod";

export const remoteToolNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.-]+$/u);

export type RemoteToolName = z.infer<typeof remoteToolNameSchema>;
