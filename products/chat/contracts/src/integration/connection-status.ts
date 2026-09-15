import { z } from "zod";

export const connectionStatusSchema = z.enum([
  "active",
  "revoked",
  "reauth_required",
]);

export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;
