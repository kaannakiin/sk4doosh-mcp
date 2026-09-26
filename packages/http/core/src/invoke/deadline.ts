import type { BackendResponse } from "../error-mapping.js";
import type { ComposedRequest } from "../request-composer.js";

export type DispatchAbortReason = "timeout" | "caller" | "pipeline";

export class LiaisoDispatchAborted extends Error {
  constructor(readonly reason: DispatchAbortReason) {
    super(messageFor(reason));
    this.name = "LiaisoDispatchAborted";
  }
}

function messageFor(reason: DispatchAbortReason): string {
  switch (reason) {
    case "timeout":
      return "liaiso: the backend did not answer within the invoke deadline.";
    case "caller":
      return "liaiso: the caller cancelled the request.";
    case "pipeline":
      return "liaiso: the backend pipeline threw before it produced a response.";
  }
}

export interface DispatchDeadline {
  readonly signal?: AbortSignal;
  /** Whole milliseconds; zero or absent means no deadline. */
  readonly timeoutMs?: number;
}

/**
 * The transport half of an invocation: one composed request out, one backend response back.
 *
 * @param signal aborted when the invoke deadline expires or the caller cancels; an implementation
 * that ignores it lets an abandoned call keep running
 */
export interface Invoker<Context> {
  invoke(
    method: string,
    request: ComposedRequest,
    body:
      { readonly contentType: string; readonly bytes: Uint8Array } | undefined,
    context: Context,
    signal: AbortSignal,
  ): Promise<BackendResponse>;
}

export interface Abandonment {
  readonly signal: AbortSignal;
  readonly reason: () => DispatchAbortReason | undefined;
  abandon(reason: DispatchAbortReason): void;
  onAbandon(listener: (reason: DispatchAbortReason) => void): void;
  dispose(): void;
}

export function armDeadline(
  deadline: DispatchDeadline | undefined,
): Abandonment {
  const signal = deadline?.signal;
  const timeoutMs = deadline?.timeoutMs ?? 0;
  const resolution = new AbortController();
  let abandoned: DispatchAbortReason | undefined;
  let listener: ((reason: DispatchAbortReason) => void) | undefined;
  const abandon = (reason: DispatchAbortReason): void => {
    if (abandoned !== undefined) {
      return;
    }
    abandoned = reason;
    resolution.abort();
    listener?.(reason);
  };
  const onAbort = (): void => abandon("caller");
  if (signal?.aborted === true) {
    abandon("caller");
  } else {
    signal?.addEventListener("abort", onAbort, { once: true });
  }
  /**
   * An un-unref'd handle keeps the event loop alive for the whole deadline after the dispatch
   * already settled, which stops a test runner and a CLI from exiting. `clearTimeout` in `dispose`
   * is the primary release; `unref` is what makes a missed one harmless.
   */
  const timer =
    timeoutMs > 0 ? setTimeout(() => abandon("timeout"), timeoutMs) : undefined;
  timer?.unref?.();
  return {
    signal: resolution.signal,
    reason: () => abandoned,
    abandon,
    onAbandon: (next) => {
      listener = next;
    },
    dispose: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export function untilAbandoned<T>(
  work: Promise<T>,
  signal: AbortSignal,
  reason: () => DispatchAbortReason | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      work.catch(() => undefined);
      reject(new LiaisoDispatchAborted(reason() ?? "caller"));
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
