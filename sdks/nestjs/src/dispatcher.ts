import { Inject, Injectable } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import {
  compose,
  type ComposedRequest,
  type RequestTemplate,
} from "@sk-mcp/core";
import {
  SK_MCP_OPTIONS,
  SkMcpOptions,
  type OuterRequest,
  type SyntheticHeaders,
} from "./options.js";
import { createSyntheticContext } from "./synthetic-context.js";

export interface DispatchResult {
  readonly status: number;
  readonly body: string;
  readonly contentType?: string;
  readonly headers: Readonly<Record<string, string>>;
}

type PipelineFunction = (req: unknown, res: unknown) => void;

const defaultUserAgent = "sk-mcp/0.0.0";

@Injectable()
export class SkMcpDispatcher {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(SK_MCP_OPTIONS) private readonly options: SkMcpOptions,
  ) {}

  dispatch(
    method: string,
    path: string,
    outer?: OuterRequest,
  ): Promise<DispatchResult>;
  dispatch(
    template: RequestTemplate,
    args: unknown,
    outer?: OuterRequest,
  ): Promise<DispatchResult>;
  async dispatch(
    target: string | RequestTemplate,
    second: unknown,
    outer?: OuterRequest,
  ): Promise<DispatchResult> {
    let method: string;
    let composed: ComposedRequest;
    if (typeof target === "string") {
      method = target.toUpperCase();
      composed = { pathAndQuery: second as string, headers: {} };
    } else {
      method = target.method;
      composed = compose(target, second);
    }

    const pipeline =
      this.adapterHost.httpAdapter?.getInstance<PipelineFunction>();
    if (!pipeline) {
      throw new Error(
        "sk-mcp: HTTP adapter is not available; initialize the Nest application before dispatching.",
      );
    }

    const synthetic = this.options.synthetic;
    const scheme = synthetic.scheme ?? (outer?.protocol || "http");
    const outerHost =
      typeof outer?.headers.host === "string" ? outer.headers.host : undefined;
    const host = synthetic.host ?? outerHost ?? "localhost";

    const headers: SyntheticHeaders = { host };
    if (synthetic.accept) {
      headers["accept"] = synthetic.accept;
    }
    headers["user-agent"] = synthetic.userAgent ?? defaultUserAgent;

    if (outer) {
      for (const trace of ["traceparent", "tracestate"]) {
        const value = outer.headers[trace];
        if (typeof value === "string") {
          headers[trace] = value;
        }
      }
      for (const carrier of this.options.identity.carriers) {
        const value = outer.headers[carrier];
        if (value !== undefined) {
          headers[carrier] = Array.isArray(value) ? value.join(", ") : value;
        }
      }
      this.options.identity.projector?.(outer, headers);
    }

    for (const [name, value] of Object.entries(composed.headers)) {
      headers[name.toLowerCase()] = value;
    }

    let body: Buffer | undefined;
    if (composed.bodyJson !== undefined) {
      headers["content-type"] = "application/json; charset=utf-8";
      body = Buffer.from(JSON.stringify(composed.bodyJson), "utf8");
    }

    const { req, res, result } = createSyntheticContext(
      method,
      composed.pathAndQuery,
      headers,
      scheme,
      body,
    );
    pipeline(req, res);
    return result;
  }
}
