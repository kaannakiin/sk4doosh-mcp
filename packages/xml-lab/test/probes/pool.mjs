import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const ENTRY = fileURLToPath(new URL("./worker-entry.mjs", import.meta.url));

export const createPool = (options = {}) => {
  const queueCap = options.queueCap ?? 4;
  const budgetMs = options.budgetMs ?? 2000;
  const beacon = options.beacon ?? null;

  let worker = null;
  let generation = 0;
  let spawnCount = 0;
  let terminations = 0;
  let running = null;
  const queue = [];
  const snapshots = new Map();
  let closed = false;

  const spawn = async () => {
    worker = new Worker(ENTRY, {
      workerData: {
        beacon,
        capacity: options.capacity ?? 4,
        diag: options.diag === true,
      },
      resourceLimits: options.resourceLimits,
    });
    spawnCount += 1;
    generation += 1;
    await once(worker, "message");
    return worker;
  };

  const ensure = async () => {
    if (worker === null) await spawn();
    return worker;
  };

  const kill = async () => {
    if (worker === null) return;
    const dying = worker;
    worker = null;
    terminations += 1;
    snapshots.clear();
    const exited = once(dying, "exit").catch(() => undefined);
    await dying.terminate();
    await exited;
  };

  const dispatch = async (job) => {
    const active = await ensure();
    const id = job.id;
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        active.off("message", onMessage);
        clearTimeout(timer);
        resolve(value);
      };
      const onMessage = (message) => {
        if (message.id !== id) return;
        finish(
          message.ok
            ? { ok: true, result: message.result }
            : { ok: false, code: "engine_error", detail: message.error },
        );
      };
      const timer = setTimeout(async () => {
        if (settled) return;
        settled = true;
        active.off("message", onMessage);
        if (job.raceOnly !== true) await kill();
        resolve({ ok: false, code: "resource_limit", detail: "timeout" });
      }, job.budgetMs ?? budgetMs);
      active.on("message", onMessage);
      if (job.signal?.aborted === true) {
        finish({ ok: false, code: "resource_limit", detail: "aborted" });
        return;
      }
      job.signal?.addEventListener("abort", async () => {
        if (settled) return;
        settled = true;
        active.off("message", onMessage);
        clearTimeout(timer);
        await kill();
        resolve({ ok: false, code: "resource_limit", detail: "aborted" });
      });
      active.postMessage(job.message);
    });
  };

  const pump = async () => {
    if (running !== null || queue.length === 0) return;
    const next = queue.shift();
    running = dispatch(next.job).then((value) => {
      running = null;
      next.resolve(value);
      void pump();
    });
  };

  let nextId = 0;

  return {
    async submit(message, jobOptions = {}) {
      if (closed)
        return { ok: false, code: "resource_limit", detail: "closed" };
      if (jobOptions.signal?.aborted === true) {
        return { ok: false, code: "resource_limit", detail: "aborted" };
      }
      if (running !== null && queue.length >= queueCap) {
        return { ok: false, code: "resource_limit", detail: "queue_full" };
      }
      nextId += 1;
      const job = {
        id: nextId,
        message: { ...message, id: nextId },
        ...jobOptions,
      };
      return await new Promise((resolve) => {
        const entry = { job, resolve };
        if (jobOptions.signal !== undefined) {
          jobOptions.signal.addEventListener("abort", () => {
            const index = queue.indexOf(entry);
            if (index >= 0) {
              queue.splice(index, 1);
              resolve({
                ok: false,
                code: "resource_limit",
                detail: "cancelled_in_queue",
              });
            }
          });
        }
        queue.push(entry);
        void pump();
      });
    },
    mintSnapshot(docId) {
      const id = `${generation}:${docId}`;
      snapshots.set(id, { generation, docId });
      return id;
    },
    resolveSnapshot(id) {
      const entry = snapshots.get(id);
      if (entry === undefined) return { ok: false, code: "stale_cursor" };
      if (entry.generation !== generation)
        return { ok: false, code: "stale_cursor" };
      return { ok: true, docId: entry.docId };
    },
    async terminate() {
      await kill();
    },
    async close() {
      closed = true;
      while (queue.length > 0) {
        queue
          .shift()
          .resolve({ ok: false, code: "resource_limit", detail: "shutdown" });
      }
      await kill();
    },
    stats: () => ({
      generation,
      spawnCount,
      terminations,
      queueDepth: queue.length,
      liveSnapshots: snapshots.size,
      alive: worker !== null,
    }),
  };
};
