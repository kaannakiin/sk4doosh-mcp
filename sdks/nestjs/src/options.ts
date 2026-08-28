import type { IncomingHttpHeaders } from "node:http";

export interface OuterRequest {
  readonly headers: IncomingHttpHeaders;
  readonly protocol?: string;
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

export class SkMcpOptions {
  readonly identity = new IdentityForwardingOptions();
  readonly synthetic: SyntheticRequestOptions = { accept: "application/json" };
}

export const SK_MCP_OPTIONS = "SK_MCP_OPTIONS";
