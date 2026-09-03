import type { RequestHandler } from "express";
import type { SkMcpResourceServerOptions } from "../options.js";

export const protectedResourceMetadataWellKnownPrefix =
  "/.well-known/oauth-protected-resource";

export function protectedResourceMetadataPath(mcpPath: string): string {
  return `${protectedResourceMetadataWellKnownPrefix}${mcpPath}`;
}

export function protectedResourceMetadataUrl(
  resource: URL,
  mcpPath: string,
): URL {
  return new URL(protectedResourceMetadataPath(mcpPath), resource.origin);
}

export function protectedResourceMetadataHandler(
  options: SkMcpResourceServerOptions,
): RequestHandler {
  return (_request, response) => {
    response.set("Cache-Control", "public, max-age=300");
    response.json({
      resource: options.resource.toString(),
      authorization_servers: options.authorizationServers.map((url) =>
        url.toString(),
      ),
      ...(options.scopesSupported !== undefined
        ? { scopes_supported: options.scopesSupported }
        : {}),
      ...(options.resourceName !== undefined
        ? { resource_name: options.resourceName }
        : {}),
      bearer_methods_supported: ["header"],
    });
  };
}
