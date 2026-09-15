import { z } from "zod";

import { connectionStatusSchema } from "./connection-status.ts";
import { integrationIdSchema } from "./integration.ts";

export const connectionIdSchema = z.uuid();

export type ConnectionId = z.infer<typeof connectionIdSchema>;

/**
 * Guard: the wire projection carries no owner and no provider subject. A
 * connection is only ever listed for the session that owns it, so an owner on
 * the wire is a value the client cannot use and a value a bug can echo onto
 * another user's page.
 */
export const connectionSchema = z.object({
  id: connectionIdSchema,
  integrationId: integrationIdSchema,
  status: connectionStatusSchema,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});

export type Connection = z.infer<typeof connectionSchema>;
