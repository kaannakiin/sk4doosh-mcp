import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { limits } from "./limits.js";
import type {
  WorkerReply,
  WorkerRequest,
  WorkerRequestBody,
  WorkerResultOf,
} from "./worker-protocol.js";

const entry = new URL("../dist/xml-worker.js", import.meta.url);

export type PoolOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: string; readonly detail?: string };

export interface XmlWorkerPool {
  readonly generation: number;
  ask<B extends WorkerRequestBody>(
    body: B,
    signal?: AbortSignal,
  ): Promise<PoolOutcome<WorkerResultOf<B["kind"]>>>;
  onGenerationChange(listener: () => void): void;
  slots(): Promise<() => void>;
  close(): Promise<void>;
  readonly stats: () => {
    readonly generation: number;
    readonly spawns: number;
    readonly terminations: number;
    readonly alive: boolean;
  };
}

export interface XmlWorkerPoolOptions {
  readonly diagnostics?: boolean;
  readonly budgetMs?: number;
  readonly queueDepth?: number;
  readonly capacity?: number;
}

export function createXmlWorkerPool(
  options: XmlWorkerPoolOptions = {},
): XmlWorkerPool {
  const budgetMs = options.budgetMs ?? limits.maxParseMs;
  const queueDepth = options.queueDepth ?? limits.maxQueueDepth;
  const capacity = options.capacity ?? limits.workerCacheEntries;
  const diagnostics = options.diagnostics ?? false;

  const listeners: (() => void)[] = [];
  const waiting: (() => void)[] = [];
  let worker: Worker | undefined;
  let generation = 0;
  let spawns = 0;
  let terminations = 0;
  let busy = false;
  let closed = false;
  let nextId = 0;

  function announce(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  async function kill(): Promise<void> {
    const dying = worker;
    worker = undefined;
    generation += 1;
    if (dying === undefined) {
      return;
    }
    terminations += 1;
    announce();
    const exited = once(dying, "exit").catch(() => undefined);
    await dying.terminate();
    await exited;
  }

  async function ensure(spawnAllowed: boolean): Promise<Worker> {
    if (worker !== undefined) {
      return worker;
    }
    if (!spawnAllowed) {
      throw new Error("closed");
    }
    const spawned = new Worker(entry, {
      workerData: { capacity, diagnostics },
      stdout: true,
      stderr: true,
    });
    spawned.stdout.resume();
    spawned.stderr.pipe(process.stderr);
    spawned.once("exit", () => {
      if (worker === spawned) {
        worker = undefined;
        generation += 1;
        announce();
      }
    });
    spawned.once("error", () => {
      if (worker === spawned) {
        worker = undefined;
        generation += 1;
        announce();
      }
    });
    worker = spawned;
    spawns += 1;
    await once(spawned, "message");
    return spawned;
  }

  async function send<B extends WorkerRequestBody>(
    request: B,
    signal?: AbortSignal,
    draining = false,
  ): Promise<PoolOutcome<WorkerResultOf<B["kind"]>>> {
    type Outcome = PoolOutcome<WorkerResultOf<B["kind"]>>;
    if (closed && !draining) {
      return { ok: false, failure: "resource_limit", detail: "closed" };
    }
    let active: Worker;
    try {
      active = await ensure(!closed);
    } catch {
      return { ok: false, failure: "resource_limit", detail: "closed" };
    }
    nextId += 1;
    const id = nextId;
    return await new Promise<Outcome>((resolve) => {
      let settled = false;
      const finish = (outcome: Outcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        active.off("message", onMessage);
        clearTimeout(timer);
        resolve(outcome);
      };
      const onMessage = (reply: WorkerReply): void => {
        if (reply.id !== id) {
          return;
        }
        if (!reply.ok) {
          finish({
            ok: false,
            failure: reply.failure,
            ...(reply.detail === undefined ? {} : { detail: reply.detail }),
          });
          return;
        }
        if (reply.kind !== request.kind) {
          finish({ ok: false, failure: "internal_error", detail: "kind" });
          return;
        }
        finish({ ok: true, value: reply.value as WorkerResultOf<B["kind"]> });
      };
      const abandon = (detail: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        active.off("message", onMessage);
        clearTimeout(timer);
        void kill().then(() => {
          resolve({ ok: false, failure: "resource_limit", detail });
        });
      };
      const timer = setTimeout(() => abandon("timeout"), budgetMs);
      if (signal?.aborted === true) {
        finish({ ok: false, failure: "resource_limit", detail: "aborted" });
        return;
      }
      signal?.addEventListener("abort", () => abandon("aborted"), {
        once: true,
      });
      active.on("message", onMessage);
      active.postMessage({ ...request, id } as WorkerRequest);
    });
  }

  return {
    get generation() {
      return generation;
    },
    onGenerationChange(listener) {
      listeners.push(listener);
    },
    async slots() {
      if (closed) {
        throw new Error("closed");
      }
      if (!busy) {
        busy = true;
        return () => {
          const next = waiting.shift();
          if (next === undefined) {
            busy = false;
          } else {
            next();
          }
        };
      }
      if (waiting.length >= queueDepth) {
        throw new Error("queue_full");
      }
      await new Promise<void>((resolve) => waiting.push(resolve));
      return () => {
        const next = waiting.shift();
        if (next === undefined) {
          busy = false;
        } else {
          next();
        }
      };
    },
    async ask(body, signal) {
      return send(body, signal);
    },
    async close() {
      closed = true;
      for (const resume of waiting.splice(0)) {
        resume();
      }
      if (worker !== undefined) {
        await Promise.race([
          send({ kind: "release" }, undefined, true),
          new Promise<PoolOutcome<null>>((resolve) =>
            setTimeout(
              () => resolve({ ok: false, failure: "resource_limit" }),
              250,
            ),
          ),
        ]);
      }
      await kill();
    },
    stats: () => ({
      generation,
      spawns,
      terminations,
      alive: worker !== undefined,
    }),
  };
}
