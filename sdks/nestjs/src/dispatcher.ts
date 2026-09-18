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
import { markSyntheticRequest, wasShortCircuited } from "./markers.js";
import { createSyntheticContext } from "./synthetic-context.js";

export interface DispatchResult {
  readonly status: number;
  readonly body: string;
  readonly contentType?: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ProbeResult extends DispatchResult {
  readonly shortCircuited: boolean;
}

/** The lifetime bound of one dispatch: the caller's cancellation channel and the clock. */
export interface DispatchDeadline {
  readonly signal?: AbortSignal;
  /** Whole milliseconds; zero or absent means no deadline. */
  readonly timeoutMs?: number;
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
    deadline?: DispatchDeadline,
  ): Promise<DispatchResult>;
  dispatch(
    template: RequestTemplate,
    args: unknown,
    outer?: OuterRequest,
    deferred?: Readonly<Record<string, unknown>>,
    deadline?: DispatchDeadline,
  ): Promise<DispatchResult>;
  async dispatch(
    target: string | RequestTemplate,
    second: unknown,
    outer?: OuterRequest,
    third?: Readonly<Record<string, unknown>> | DispatchDeadline,
    fourth?: DispatchDeadline,
  ): Promise<DispatchResult> {
    let method: string;
    let composed: ComposedRequest;
    let deadline: DispatchDeadline | undefined;
    if (typeof target === "string") {
      method = target.toUpperCase();
      composed = { pathAndQuery: second as string, headers: {} };
      deadline = third as DispatchDeadline | undefined;
    } else {
      method = target.method;
      composed = compose(
        target,
        second,
        third as Readonly<Record<string, unknown>> | undefined,
      );
      deadline = fourth;
    }

    return this.run(method, composed, outer, false, deadline);
  }

  async probe(
    method: string,
    path: string,
    outer?: OuterRequest,
    deadline?: DispatchDeadline,
  ): Promise<ProbeResult> {
    const result = await this.run(
      method.toUpperCase(),
      { pathAndQuery: path, headers: {} },
      outer,
      true,
      deadline,
    );
    return result;
  }

  private async run(
    method: string,
    composed: ComposedRequest,
    outer: OuterRequest | undefined,
    probe: boolean,
    deadline: DispatchDeadline | undefined,
  ): Promise<ProbeResult> {
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

    const { req, res, result, abort } = createSyntheticContext(
      method,
      composed.pathAndQuery,
      headers,
      scheme,
      body,
      outer?.connection,
    );
    markSyntheticRequest(req, probe);

    const signal = deadline?.signal;
    const onAbort = (): void => abort("caller");
    if (signal?.aborted === true) {
      abort("caller");
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }

    const timeoutMs = deadline?.timeoutMs ?? 0;
    /**
     * An un-unref'd handle keeps the event loop alive for the whole deadline after the dispatch
     * already settled, which stops a test runner and a CLI from exiting. `clearTimeout` in the
     * `finally` is the primary release; `unref` is what makes a missed one harmless.
     */
    const timer =
      timeoutMs > 0 ? setTimeout(() => abort("timeout"), timeoutMs) : undefined;
    timer?.unref?.();

    try {
      pipeline(req, res);
    } catch (error) {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
      abort("pipeline");
      /**
       * Settling the context rejects `result`, which nothing awaits on this path because the
       * pipeline's own error is the useful one. Without this no-op handler that rejection is
       * unhandled and crashes the process under Node's default policy.
       */
      result.catch(() => undefined);
      throw error;
    }
    try {
      const dispatched = await result;
      return { ...dispatched, shortCircuited: wasShortCircuited(req) };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
