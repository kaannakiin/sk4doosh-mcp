import type {
  Backend,
  BackendProbe,
  Completion,
  CompletionRequest,
  QueuedBackend,
} from "./port.js";

const settle = (): void => undefined;

/**
 * Lets one request at a time reach the host.
 *
 * Guard: four parallel requests to one GPU finished only 1.1x faster than four
 * sequential ones, while codex was measured firing 17 calls at once. Queueing
 * here keeps each call inside its own timeout instead of 17 timing out
 * together. `probe` bypasses the queue so a status question never waits
 * behind a long job.
 */
export function createSerialBackend(inner: Backend): QueuedBackend {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const enqueue = <T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    pending += 1;
    const run = tail.then(() => {
      signal?.throwIfAborted();
      return task();
    });
    tail = run.then(settle, settle);
    return run.finally(() => {
      pending -= 1;
    });
  };

  return {
    model: inner.model,
    contextTokens: inner.contextTokens,
    get pending(): number {
      return pending;
    },
    complete: (request: CompletionRequest): Promise<Completion> =>
      enqueue(() => inner.complete(request), request.signal),
    probe: (signal?: AbortSignal): Promise<BackendProbe> => inner.probe(signal),
    warm: (): Promise<void> => enqueue(() => inner.warm()),
  };
}
