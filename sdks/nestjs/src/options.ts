import type { IncomingHttpHeaders } from "node:http";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { Recognizer, SelectionDefault } from "@sk-mcp/core";
import type { ArgumentRule, JsonValue } from "./decorators.js";
import type { CatalogSeverity } from "./discovery/diagnostics.js";
import type { TypeShapeBinderOptions } from "./discovery/type-shape.js";
import type { OuterConnection } from "./outer-connection.js";
import type { SkMcpTransportOptions } from "./transport/session-store.js";

export interface OuterRequest {
  readonly headers: IncomingHttpHeaders;
  readonly protocol?: string;
  readonly connection?: OuterConnection;
  /**
   * The MCP transport's verified token, when `resourceServer` is configured.
   *
   * Without it a value provider sees headers only and decodes the token itself; the C# side reads
   * `HttpContext.User` and always has one. The two platforms are not symmetric here.
   */
  readonly auth?: VerifiedToken;
}

export interface VerifiedToken {
  readonly clientId?: string;
  readonly scopes?: readonly string[];
  readonly resource?: string | URL;
  readonly expiresAt?: number;
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** What a value provider sees. */
export interface McpCaller {
  readonly subject?: string;
  readonly clientId?: string;
  readonly scopes: readonly string[];
  readonly resource?: string;
  readonly expiresAt?: Date;
  claim(name: string): string | undefined;
  header(name: string): string | undefined;
}

export function callerOf(outer: OuterRequest | undefined): McpCaller {
  const auth = outer?.auth;
  const extra = auth?.extra ?? {};
  const subject =
    typeof extra["sub"] === "string" ? extra["sub"] : auth?.clientId;
  return {
    ...(subject === undefined ? {} : { subject }),
    ...(auth?.clientId === undefined ? {} : { clientId: auth.clientId }),
    scopes: auth?.scopes ?? [],
    ...(auth?.resource === undefined
      ? {}
      : { resource: auth.resource.toString() }),
    ...(auth?.expiresAt === undefined
      ? {}
      : { expiresAt: new Date(auth.expiresAt * 1000) }),
    claim: (name) => {
      const value = extra[name];
      return typeof value === "string" ? value : undefined;
    },
    header: (name) => {
      const value = outer?.headers[name.toLowerCase()];
      return Array.isArray(value) ? value.join(", ") : value;
    },
  };
}

export type ArgumentValueProvider = (
  caller: McpCaller,
) => JsonValue | undefined | Promise<JsonValue | undefined>;

export interface CurationTarget {
  readonly controller?: NewableFunction;
  readonly handler?: string;
  readonly method?: string;
  /** Matched against the final descriptor route, after prefixes and versioning. */
  readonly route?: string;
}

export interface CurationRule {
  readonly target: CurationTarget;
  readonly rules: Readonly<Record<string, ArgumentRule>>;
  readonly sealed: boolean;
  readonly specificity: number;
}

function specificityOf(target: CurationTarget): number {
  if (target.handler !== undefined) {
    return 3;
  }
  if (target.controller !== undefined || target.route !== undefined) {
    return 2;
  }
  return 1;
}

/**
 * Central curation: rules for controllers the host cannot decorate, and rules that repeat.
 *
 * `seal` exists because plain "most specific wins" lets a method decorator defeat a tenancy rule.
 * A sealed field cannot be overridden by any layer; attempting it is a build error.
 */
export class ArgumentCurationOptions {
  private readonly valueProviders = new Map<string, ArgumentValueProvider>();
  private readonly declarations: CurationRule[] = [];

  get providers(): ReadonlyMap<string, ArgumentValueProvider> {
    return this.valueProviders;
  }

  get rules(): readonly CurationRule[] {
    return this.declarations;
  }

  provide(name: string, provider: ArgumentValueProvider): this {
    this.valueProviders.set(name, provider);
    return this;
  }

  curate(
    target: CurationTarget,
    rules: Readonly<Record<string, ArgumentRule>>,
  ): this {
    this.declarations.push({
      target,
      rules,
      sealed: false,
      specificity: specificityOf(target),
    });
    return this;
  }

  everywhere(rules: Readonly<Record<string, ArgumentRule>>): this {
    return this.curate({}, rules);
  }

  seal(
    target: CurationTarget,
    rules: Readonly<Record<string, ArgumentRule>>,
  ): this {
    this.declarations.push({
      target,
      rules,
      sealed: true,
      specificity: specificityOf(target),
    });
    return this;
  }
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
  readonly arguments = new ArgumentCurationOptions();
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
