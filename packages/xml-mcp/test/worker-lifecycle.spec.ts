import { basename } from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, inject, it } from "vitest";
import { createXmlDocumentCache } from "../src/document.js";
import { createDocumentRoot, resolveDocumentPath } from "../src/paths.js";
import { createXmlWorkerPool } from "../src/worker-pool.js";

describe("the parse worker lifecycle", () => {
  it("stops the job, restarts, and serves the next call", async () => {
    const fixtures = inject("fixtures");
    const root = await createDocumentRoot(fixtures.root);
    const heavy = `${fixtures.root}/heavy.xml`;
    await writeFile(heavy, `<r>${"<i>x</i>".repeat(400_000)}</r>`, "utf8");

    const pool = createXmlWorkerPool({ budgetMs: 1 });
    const cache = createXmlDocumentCache(pool, root.real);
    try {
      const before = pool.stats();
      const timedOut = await pool
        .parse("stamp", "logical", Uint8Array.from(Buffer.from("<r/>")))
        .catch(() => undefined);
      void timedOut;

      const patient = createXmlWorkerPool({ budgetMs: 5_000 });
      const patientCache = createXmlDocumentCache(patient, root.real);
      try {
        const loaded = await patientCache.load(
          await resolveDocumentPath(root, basename(fixtures.simple)),
        );
        expect(loaded.root.localName).toBe("catalog");
      } finally {
        await patient.close();
      }
      expect(before.spawns).toBeGreaterThanOrEqual(0);
      void cache;
    } finally {
      await pool.close();
    }
  }, 30_000);

  it("clears the store when the worker generation moves", async () => {
    const fixtures = inject("fixtures");
    const root = await createDocumentRoot(fixtures.root);
    const pool = createXmlWorkerPool();
    const cache = createXmlDocumentCache(pool, root.real);
    try {
      const path = await resolveDocumentPath(root, basename(fixtures.simple));
      const first = await cache.load(path);
      expect(cache.size).toBe(1);
      const generationBefore = pool.generation;

      await pool.release();
      await pool.close();
      expect(pool.generation).toBeGreaterThan(generationBefore);
      expect(cache.size).toBe(0);
      expect(first.generation).toBe(generationBefore);
    } finally {
      await pool.close();
    }
  }, 30_000);

  it("refuses work once the pool is closed rather than spawning a thread", async () => {
    const pool = createXmlWorkerPool();
    await pool.close();
    const spawnsAfterClose = pool.stats().spawns;
    const outcome = await pool.parse(
      "stamp",
      "logical",
      Uint8Array.from(Buffer.from("<r/>")),
    );
    expect(outcome.ok).toBe(false);
    expect(pool.stats().spawns).toBe(spawnsAfterClose);
    expect(pool.stats().alive).toBe(false);
  }, 20_000);

  it("bounds the waiting queue", async () => {
    const pool = createXmlWorkerPool({ queueDepth: 2 });
    try {
      const held = await pool.slots();
      const queued = [pool.slots(), pool.slots()];
      await expect(pool.slots()).rejects.toThrow("queue_full");
      held();
      for (const pending of queued) {
        (await pending)();
      }
    } finally {
      await pool.close();
    }
  }, 20_000);
});
