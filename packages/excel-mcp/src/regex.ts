import { Worker } from "node:worker_threads";
import { SkMcpExcelError } from "./errors.js";

let running = 0;
const waiting: {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}[] = [];
const workers = new Set<Worker>();

async function acquire(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    throw new SkMcpExcelError(
      "resource_limit",
      "The regex search was cancelled.",
    );
  if (running < 2) {
    running += 1;
    return;
  }
  if (waiting.length >= 8)
    throw new SkMcpExcelError(
      "resource_limit",
      "The regex queue is full.",
      "Retry after another search completes.",
    );
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => signal?.removeEventListener("abort", abort);
    const entry = {
      resolve: () => {
        cleanup();
        resolve();
      },
      reject: (error: Error) => {
        cleanup();
        reject(error);
      },
    };
    const abort = (): void => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      entry.reject(
        new SkMcpExcelError(
          "resource_limit",
          "The queued regex search was cancelled.",
        ),
      );
    };
    waiting.push(entry);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
function release(): void {
  const next = waiting.shift();
  if (next !== undefined) next.resolve();
  else running -= 1;
}

export async function closeRegexWorkers(): Promise<void> {
  for (const pending of waiting.splice(0))
    pending.reject(
      new SkMcpExcelError(
        "resource_limit",
        "The regex service is shutting down.",
      ),
    );
  await Promise.all(
    [...workers].map(async (worker) => {
      await worker.terminate();
    }),
  );
}

export async function withRegex<T>(
  query: string,
  caseSensitive: boolean,
  run: (
    test: (texts: readonly string[]) => Promise<readonly boolean[]>,
  ) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (query.length > 256 || query.includes("\\p{") || query.includes("\\P{"))
    throw new SkMcpExcelError(
      "invalid_pattern",
      "Regex patterns must be at most 256 characters and cannot use Unicode property escapes.",
    );
  await acquire(signal);
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    if (signal?.aborted)
      throw new SkMcpExcelError(
        "resource_limit",
        "The regex search was cancelled.",
      );
    worker = new Worker(new URL("../dist/regex-worker.js", import.meta.url), {
      workerData: { query, caseSensitive },
      resourceLimits: {
        maxOldGenerationSizeMb: 24,
        maxYoungGenerationSizeMb: 8,
        stackSizeMb: 2,
      },
    });
    const active = worker;
    workers.add(active);
    let pending:
      | { resolve: (value: unknown) => void; reject: (error: Error) => void }
      | undefined;
    let failure: Error | undefined;
    const fail = (error: Error): void => {
      failure = error;
      pending?.reject(error);
      pending = undefined;
    };
    active.on("error", () =>
      fail(
        new SkMcpExcelError(
          "resource_limit",
          "The regex worker exceeded its resource budget.",
        ),
      ),
    );
    active.on("exit", () =>
      fail(
        new SkMcpExcelError(
          "resource_limit",
          "The regex worker stopped before completing the search.",
        ),
      ),
    );
    active.on("message", (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "error" in message
      ) {
        fail(
          new SkMcpExcelError(
            message.error === "invalid_pattern"
              ? "invalid_pattern"
              : "resource_limit",
            "The regular expression could not be evaluated within its constraints.",
          ),
        );
      } else {
        pending?.resolve(message);
        pending = undefined;
      }
    });
    const receive = (): Promise<unknown> =>
      new Promise((resolve, reject) => {
        if (failure !== undefined) reject(failure);
        else pending = { resolve, reject };
      });
    timer = setTimeout(() => {
      fail(
        new SkMcpExcelError(
          "resource_limit",
          "The regex search exceeded its 2 second deadline.",
          "Narrow the range or use a literal search.",
        ),
      );
      void active.terminate();
    }, 2000);
    const ready = await receive();
    abort = () => {
      fail(
        new SkMcpExcelError(
          "resource_limit",
          "The regex search was cancelled.",
        ),
      );
      void active.terminate();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    if (
      typeof ready !== "object" ||
      ready === null ||
      !("ready" in ready) ||
      ready.ready !== true
    )
      throw new SkMcpExcelError(
        "internal_error",
        "Invalid regex worker handshake.",
      );
    return await run(async (texts) => {
      if (Buffer.byteLength(JSON.stringify(texts)) > 65536)
        throw new SkMcpExcelError(
          "resource_limit",
          "A regex batch exceeded 64 KiB.",
        );
      const response = receive();
      active.postMessage(texts);
      const result = await response;
      if (
        !Array.isArray(result) ||
        result.length !== texts.length ||
        !result.every((value: unknown) => typeof value === "boolean")
      )
        throw new SkMcpExcelError(
          "internal_error",
          "Invalid regex worker result.",
        );
      return result as boolean[];
    });
  } finally {
    if (abort !== undefined) signal?.removeEventListener("abort", abort);
    if (timer !== undefined) clearTimeout(timer);
    if (worker !== undefined) {
      await worker.terminate();
      workers.delete(worker);
    }
    release();
  }
}
