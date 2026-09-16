import { z } from "zod";

/**
 * Guard: these schemas narrow the fields this platform stores, and nothing more.
 * `oauth4webapi` parses both documents and enforces their identity claims, but
 * it asserts only that `issuer` and `resource` are strings — every other field
 * is typed optional and unvalidated. The columns behind `token_endpoint` and
 * `authorization_endpoint` are `TEXT NOT NULL`, so a server answering a number
 * there would fail at insert time rather than at read time.
 */
export const protectedResourceMetadataSchema = z.object({
  authorization_servers: z.array(z.url()).min(1),
  scopes_supported: z.array(z.string()).optional(),
});

export type ProtectedResourceMetadata = z.infer<
  typeof protectedResourceMetadataSchema
>;

export const authorizationServerMetadataSchema = z.object({
  issuer: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  registration_endpoint: z.url().optional(),
  revocation_endpoint: z.url().optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
  scopes_supported: z.array(z.string()).optional(),
});

export type AuthorizationServerMetadata = z.infer<
  typeof authorizationServerMetadataSchema
>;
