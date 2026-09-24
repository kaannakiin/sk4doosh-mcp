import { z } from "zod";

import { connectionStatusSchema } from "./connection-status.ts";
import { integrationApprovalSettingSchema } from "./tool-approval-mode.ts";
import {
  integrationAuthModeSchema,
  integrationIdSchema,
  integrationOriginSchema,
} from "./integration.ts";

/**
 * Guard: a fragment is refused rather than trimmed. This url is the RFC 8707
 * `resource` value and travels verbatim to the authorization server, which
 * compares it against what the resource metadata claimed; a fragment makes the
 * two disagree over a part of the url no server ever receives.
 */
export const mcpServerUrlSchema = z
  .url()
  .min(8)
  .max(2048)
  .refine((value) => !value.includes("#"), { error: "no_fragment" });

export type McpServerUrl = z.infer<typeof mcpServerUrlSchema>;

/**
 * Guard: `approvalMode` defaults to `always_ask`, not to the reader's own mode.
 * A server nobody has vetted yet starts where every call is asked about, and
 * trusting it more is a choice the reader makes, here or later.
 */
export const createIntegrationSchema = z.object({
  mcpUrl: mcpServerUrlSchema,
  displayName: z.string().trim().min(1).max(200).optional(),
  approvalMode: integrationApprovalSettingSchema.default("always_ask"),
});

export type CreateIntegration = z.infer<typeof createIntegrationSchema>;

/** What a client sends: `approvalMode` may be left to its default. */
export type CreateIntegrationRequest = z.input<typeof createIntegrationSchema>;

/**
 * Guard: the projection names neither the issuer nor the client id. Both were
 * negotiated by this platform on the owner's behalf and neither is actionable in
 * a browser, while a client id on the wire is a value a bug can echo onto
 * another owner's page.
 */
export const integrationSummarySchema = z.object({
  id: integrationIdSchema,
  displayName: z.string(),
  mcpUrl: z.url(),
  origin: integrationOriginSchema,
  authMode: integrationAuthModeSchema,
  toolCount: z.int().nonnegative(),
  approvalMode: integrationApprovalSettingSchema,
  connection: z
    .object({
      status: connectionStatusSchema,
      authorizedAt: z.iso.datetime().nullable(),
      lastUsedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
});

export type IntegrationSummary = z.infer<typeof integrationSummarySchema>;

export const integrationListResponseSchema = z.object({
  integrations: z.array(integrationSummarySchema),
});

export type IntegrationListResponse = z.infer<
  typeof integrationListResponseSchema
>;

/**
 * Why a server could not be registered, as a closed vocabulary.
 *
 * Guard: nothing the remote server said reaches the reader. Its metadata, its
 * registration error and its `error_description` are all text a registrant
 * authored, and a message rendered on this product's own page is read as this
 * product's words. The copy for each of these lives in the locale files.
 */
export const registrationFailureSchema = z.enum([
  "integration_url_invalid",
  "integration_duplicate",
  "integration_unreachable",
  "integration_not_mcp",
  "integration_too_large",
  "integration_auth_unsupported",
]);

export type RegistrationFailure = z.infer<typeof registrationFailureSchema>;
