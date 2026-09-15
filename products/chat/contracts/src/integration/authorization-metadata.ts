import { z } from "zod";

export const protectedResourceMetadataSchema = z.object({
  resource: z.url(),
  authorization_servers: z.array(z.url()).min(1),
  scopes_supported: z.array(z.string()).optional(),
  bearer_methods_supported: z.array(z.string()).optional(),
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
  grant_types_supported: z.array(z.string()).optional(),
  scopes_supported: z.array(z.string()).optional(),
});

export type AuthorizationServerMetadata = z.infer<
  typeof authorizationServerMetadataSchema
>;
