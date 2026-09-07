import type { IncomingHttpHeaders } from "node:http";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { Recognizer, SelectionDefault } from "@sk-mcp/core";
import type { CatalogSeverity } from "./discovery/diagnostics.js";
import type { TypeShapeBinderOptions } from "./discovery/type-shape.js";
import type { OuterConnection } from "./outer-connection.js";
import type { SkMcpTransportOptions } from "./transport/session-store.js";

export interface OuterRequest {
  readonly headers: IncomingHttpHeaders;
  readonly protocol?: string;
  readonly connection?: OuterConnection;
}

export type SyntheticHeaders = Record<string, string>;

export class IdentityForwardingOptions {
  private readonly names = new Set<string>(["authorization"]);

  projector?: (outer: OuterRequest, syntheticHeaders: SyntheticHeaders) => void;

  get carriers(): ReadonlySet<string> {
    return this.names;
  }

  forward(name: string): this {
    this.names.add(name.toLowerCase());
    return this;
  }

  clear(): this {
    this.names.clear();
    return this;
  }

  project(
    projector: (
      outer: OuterRequest,
      syntheticHeaders: SyntheticHeaders,
    ) => void,
  ): this {
    this.projector = projector;
    return this;
  }
}

export interface SyntheticRequestOptions {
  host?: string;
  scheme?: string;
  accept?: string;
  userAgent?: string;
}

export interface SkMcpCacheOptions {
  lifetimeMs: number;
  maxCallers: number;
}

export class ErrorMappingOptions {
  private readonly items: Recognizer[] = [];

  get recognizers(): readonly Recognizer[] {
    return this.items;
  }

  recognize(recognizer: Recognizer): this {
    this.items.push(recognizer);
    return this;
  }
}

export interface SkMcpResourceServerOptions {
  resource: URL;
  authorizationServers: URL[];
  scopesSupported?: string[];
  resourceName?: string;
  verifier: OAuthTokenVerifier;
  mcpPath?: string;
}

export interface SkMcpSelectionOptions {
  default: SelectionDefault;
}

export interface SkMcpNamingOptions {
  prefixMode: "always" | "onCollision";
  prefix?: (container: string) => string | undefined;
}

export interface SkMcpDiagnosticsOptions {
  failOn?: CatalogSeverity;
  readonly escalate: Set<string>;
  readonly downgrade: Set<string>;
}

export type SkMcpVisibilityTier = "declarative" | "probe";

export interface SkMcpVisibilityOptions {
  tier: SkMcpVisibilityTier;
  onUnknown: "show" | "hide";
  probeTopK: number;
  probeConcurrency: number;
  readonly probeValues: Map<string, string>;
}

export class SkMcpOptions {
  readonly identity = new IdentityForwardingOptions();
  readonly synthetic: SyntheticRequestOptions = { accept: "application/json" };
  readonly cache: SkMcpCacheOptions = { lifetimeMs: 30_000, maxCallers: 128 };
  readonly errors = new ErrorMappingOptions();
  readonly transport: SkMcpTransportOptions = { sessionMode: "stateless" };
  readonly selection: SkMcpSelectionOptions = { default: "exclude" };
  readonly naming: SkMcpNamingOptions = { prefixMode: "always" };
  readonly diagnostics: SkMcpDiagnosticsOptions = {
    failOn: "fatal",
    escalate: new Set<string>(),
    downgrade: new Set<string>(),
  };
  readonly visibility: SkMcpVisibilityOptions = {
    tier: "declarative",
    onUnknown: "show",
    probeTopK: 25,
    probeConcurrency: 4,
    probeValues: new Map<string, string>(),
  };
  schema?: TypeShapeBinderOptions;
  resourceServer?: SkMcpResourceServerOptions;
}

export const SK_MCP_OPTIONS = "SK_MCP_OPTIONS";
