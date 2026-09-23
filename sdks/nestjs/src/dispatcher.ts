import { Inject, Injectable } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import {
  compose,
  type ComposedRequest,
  type RequestTemplate,
} from "@sk-mcp/core";
import { writeBody, type RefResolver } from "./body-writer.js";
import { SkMcpFileRefused } from "./files.js";
import {
  callerOf,
  SK_MCP_OPTIONS,
  SkMcpOptions,
  type InvokeTarget,
  type OuterRequest,
  type SyntheticHeaders,
} from "./options.js";
import { markSyntheticRequest, wasShortCircuited } from "./markers.js";
import {
  createSyntheticContext,
  SkMcpDispatchAborted,
  type DispatchAbortReason,
} from "./synthetic-context.js";

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

/** What an invocation's body needs beyond its arguments: the budgets and whom a `ref` is resolved for. */
export interface DispatchFiles {
  readonly target: InvokeTarget;
  readonly maxInlineFileBytes: number;
  readonly maxFileBytes: number;
}

type PipelineFunction = (req: unknown, res: unknown) => void;

const safeFilename = /^[^"\r\n\0/\\]+$/;

const safeMediaType =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=(?:[A-Za-z0-9!#$&^_.+-]+|"[^"\r\n\\]*"))*$/;

/**
 * Guard: a resolver is host code, but its filename and media type land in a part header. One that
 * would break the header, or carries a path, is skipped for the next rung of the ladder rather than
 * written.
 */
function usableFilename(value: string | undefined): string | undefined {
  return value !== undefined && safeFilename.test(value) ? value : undefined;
}

function usableMediaType(value: string | undefined): string | undefined {
  return value !== undefined && safeMediaType.test(value) ? value : undefined;
}

function untilAbandoned<T>(
  work: Promise<T>,
  signal: AbortSignal,
  reason: () => DispatchAbortReason | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      work.catch(() => undefined);
      reject(new SkMcpDispatchAborted(reason() ?? "caller"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error as Error);
      },
    );
  });
}

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
    files?: DispatchFiles,
  ): Promise<DispatchResult>;
  async dispatch(
    target: string | RequestTemplate,
    second: unknown,
    outer?: OuterRequest,
    third?: Readonly<Record<string, unknown>> | DispatchDeadline,
    fourth?: DispatchDeadline,
    files?: DispatchFiles,
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
        files === undefined
          ? undefined
          : { maxInlineFileBytes: files.maxInlineFileBytes },
      );
      deadline = fourth;
    }

    return this.run(method, composed, outer, false, deadline, files);
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
    files?: DispatchFiles,
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

    const signal = deadline?.signal;
    const timeoutMs = deadline?.timeoutMs ?? 0;
    const resolution = new AbortController();
    let abandoned: DispatchAbortReason | undefined;
    let abortContext: ((reason: DispatchAbortReason) => void) | undefined;
    const abandon = (reason: DispatchAbortReason): void => {
      if (abandoned !== undefined) {
        return;
      }
      abandoned = reason;
      resolution.abort();
      abortContext?.(reason);
    };
    const onAbort = (): void => abandon("caller");
    if (signal?.aborted === true) {
      abandon("caller");
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
    /**
     * An un-unref'd handle keeps the event loop alive for the whole deadline after the dispatch
     * already settled, which stops a test runner and a CLI from exiting. `clearTimeout` in the
     * `finally` is the primary release; `unref` is what makes a missed one harmless.
     */
    const timer =
      timeoutMs > 0
        ? setTimeout(() => abandon("timeout"), timeoutMs)
        : undefined;
    timer?.unref?.();

    try {
      /**
       * Guard: the deadline is armed before any `ref` is resolved, so a resolver that hangs is
       * bounded exactly like a backend that hangs. Resolving earlier — during the validating
       * composition — would let it outlive the call it serves.
       */
      const written =
        composed.body === undefined
          ? undefined
          : await untilAbandoned(
              writeBody(
                composed.body,
                this.refResolver(outer, files, resolution.signal),
              ),
              resolution.signal,
              () => abandoned,
            );
      if (abandoned !== undefined) {
        throw new SkMcpDispatchAborted(abandoned);
      }
      if (written !== undefined) {
        headers["content-type"] = written.contentType;
      }

      const { req, res, result, abort } = createSyntheticContext(
        method,
        composed.pathAndQuery,
        headers,
        scheme,
        written?.bytes,
        outer?.connection,
      );
      markSyntheticRequest(req, probe);
      abortContext = abort;

      try {
        pipeline(req, res);
      } catch (error) {
        abort("pipeline");
        /**
         * Settling the context rejects `result`, which nothing awaits on this path because the
         * pipeline's own error is the useful one. Without this no-op handler that rejection is
         * unhandled and crashes the process under Node's default policy.
         */
        result.catch(() => undefined);
        throw error;
      }
      const dispatched = await result;
      return { ...dispatched, shortCircuited: wasShortCircuited(req) };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private refResolver(
    outer: OuterRequest | undefined,
    files: DispatchFiles | undefined,
    signal: AbortSignal,
  ): RefResolver {
    return async (file, field) => {
      const resolver = this.options.files.resolver;
      if (resolver === undefined || files === undefined) {
        throw new Error(
          `sk-mcp: file argument '${field}' is a ref but no file resolver is bound.`,
        );
      }
      const limit = files.maxFileBytes;
      const outcome = await resolver.resolve({
        ref: file.ref,
        field,
        target: files.target,
        caller: callerOf(outer),
        maxBytes: limit,
        signal,
      });
      if (!outcome.ok) {
        throw new SkMcpFileRefused(field, outcome.reason, limit);
      }
      if (outcome.bytes.byteLength > limit) {
        throw new SkMcpFileRefused(field, "too_large", limit);
      }
      return {
        bytes: outcome.bytes,
        filename:
          file.filename ??
          usableFilename(outcome.filename) ??
          file.fallbackFilename,
        mediaType:
          file.mediaType ??
          usableMediaType(outcome.mediaType) ??
          file.fallbackMediaType,
      };
    };
  }
}
