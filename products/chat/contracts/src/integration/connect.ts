import { z } from "zod";

import { integrationIdSchema } from "./integration.ts";

export const connectParamsSchema = z.object({
  integrationId: integrationIdSchema,
});

export type ConnectParams = z.infer<typeof connectParamsSchema>;

/**
 * Guard: `iss` is accepted because RFC 9207 lets the authorization server name
 * itself in the callback, and a mismatch against the attempt's snapshot is a
 * mix-up attack — an authorization code minted by one server presented to
 * another's token endpoint.
 */
export const connectCallbackQuerySchema = z.object({
  state: z.string().min(1).max(512),
  code: z.string().min(1).max(4096).optional(),
  iss: z.string().max(2048).optional(),
  error: z.string().min(1).max(256).optional(),
  error_description: z.string().max(1024).optional(),
});

export type ConnectCallbackQuery = z.infer<typeof connectCallbackQuerySchema>;

/**
 * What the browser is told when it comes back. These reach the web app as a
 * query parameter, so they are a closed vocabulary rather than a message: the
 * copy belongs to the locale files, and nothing a remote server said is
 * reflected into the address bar.
 */
export const connectionOutcomeSchema = z.enum([
  "connected",
  "attempt_invalid",
  "integration_unavailable",
  "access_denied",
  "provider_unavailable",
  "connection_failed",
]);

export type ConnectionOutcome = z.infer<typeof connectionOutcomeSchema>;

/**
 * Guard: the callback lands on a url a reader can edit, so the value is
 * classified rather than trusted. The api only ever sends a member of this
 * vocabulary, but an unclassified string rendered on the page would make the
 * closed vocabulary rule enforce nothing.
 *
 * @param value the `status` a navigation carried
 * @returns whether it is one this product wrote
 */
export function isConnectionOutcome(
  value: unknown,
): value is ConnectionOutcome {
  return connectionOutcomeSchema.safeParse(value).success;
}
