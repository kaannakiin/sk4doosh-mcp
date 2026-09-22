import os from "node:os";
import { performance } from "node:perf_hooks";
import { Buffer } from "node:buffer";
import { createPool } from "./pool.mjs";

const rows = [];
const notes = [];
const limits = [];
const metrics = {};

const record = (id, expected, actual, pass) =>
  rows.push({ id, expected, actual: String(actual).slice(0, 300), pass });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const smallDocument = Buffer.from(
  `<r>${"<i>x</i>".repeat(2000)}</r>`,
  "utf8",
).toString("base64");

const quadraticDocument = Buffer.from(
  `<r>${Array.from({ length: 30000 }, (_, index) => `<i>v${index % 40}</i>`).join("")}</r>`,
  "utf8",
).toString("base64");

const EXPENSIVE = "count(//i[. = following-sibling::i])";

const cpuBusyFraction = async (windowMs) => {
  const before = process.cpuUsage();
  await sleep(windowMs);
  const after = process.cpuUsage(before);
  return (after.user + after.system) / 1000 / windowMs;
};

const pool = createPool({ budgetMs: 1500 });

const warm = await pool.submit({
  kind: "parse",
  docId: "warm",
  base64: smallDocument,
});
record(
  "e06-00-baseline-parse-succeeds",
  "ok",
  JSON.stringify(warm),
  warm.ok === true,
);

const expensiveStarted = performance.now();
const timedOut = await pool.submit({
  kind: "query",
  docId: "expensive",
  base64: quadraticDocument,
  expression: EXPENSIVE,
});
metrics.timeoutResponseMs = Number(
  (performance.now() - expensiveStarted).toFixed(1),
);
record(
  "e06-02-expensive-query-on-valid-document-times-out",
  "resource_limit within budget + slack",
  `${JSON.stringify(timedOut)} in ${metrics.timeoutResponseMs}ms`,
  timedOut.ok === false &&
    timedOut.code === "resource_limit" &&
    metrics.timeoutResponseMs < 1500 + 750,
);

const busyAfterTerminate = await cpuBusyFraction(1000);
metrics.busyFractionAfterTerminate = Number(busyAfterTerminate.toFixed(4));

const statsAfterTerminate = pool.stats();
void busyAfterTerminate;
record(
  "e06-10-queue-and-snapshots-cleared-after-termination",
  "queueDepth 0, no live snapshots, generation advanced",
  JSON.stringify(statsAfterTerminate),
  statsAfterTerminate.queueDepth === 0 &&
    statsAfterTerminate.liveSnapshots === 0 &&
    statsAfterTerminate.terminations === 1,
);

const afterTimeout = await pool.submit({
  kind: "parse",
  docId: "recovered",
  base64: smallDocument,
});
record(
  "e06-08-next-normal-request-works-after-timeout",
  "ok, exactly one respawn",
  `${JSON.stringify(afterTimeout)} ${JSON.stringify(pool.stats())}`,
  afterTimeout.ok === true && pool.stats().spawnCount === 2,
);

const racePool = createPool({ budgetMs: 1500 });
await racePool.submit({ kind: "parse", docId: "warm", base64: smallDocument });
const raceOutcome = await racePool.submit(
  {
    kind: "query",
    docId: "expensive",
    base64: quadraticDocument,
    expression: EXPENSIVE,
  },
  { raceOnly: true },
);
const busyWithoutTerminate = await cpuBusyFraction(1000);
metrics.busyFractionWithoutTerminate = Number(busyWithoutTerminate.toFixed(4));
void raceOutcome;
await racePool.close();

const baselineEstablished = busyWithoutTerminate > 0.3;
const stopRatio =
  busyAfterTerminate === 0
    ? Infinity
    : busyWithoutTerminate / busyAfterTerminate;
metrics.cpuOracle = {
  busyFractionAfterTerminate: metrics.busyFractionAfterTerminate,
  busyFractionWithoutTerminate: metrics.busyFractionWithoutTerminate,
  stopRatio: stopRatio === Infinity ? "infinite" : Number(stopRatio.toFixed(1)),
  negativeControlEstablishedBaseline: baselineEstablished,
};

record(
  "e06-05b-negative-control-establishes-a-busy-baseline",
  "without terminate the same job keeps a core busy, so a low reading after terminate cannot be explained by the fixture finishing on its own",
  JSON.stringify(metrics.cpuOracle),
  baselineEstablished,
);

record(
  "e06-05a-work-stops-after-terminate",
  baselineEstablished
    ? "cpu after terminate is at least ten times lower than the negative control on the same host"
    : "inconclusive: the negative control never established a busy baseline, so no conclusion may be drawn",
  JSON.stringify(metrics.cpuOracle),
  baselineEstablished === false ? false : stopRatio >= 10,
);

const beaconBuffer = new SharedArrayBuffer(4);
const beaconView = new Int32Array(beaconBuffer);
const beaconPool = createPool({ budgetMs: 900, beacon: beaconBuffer });
const loopResult = await beaconPool.submit({
  kind: "loop",
  base64: smallDocument,
  iterations: 20000,
});
const beaconAtStop = Atomics.load(beaconView, 0);
await sleep(500);
await sleep(0);
const beaconLater = Atomics.load(beaconView, 0);
metrics.beaconAtStop = beaconAtStop;
metrics.beaconLater = beaconLater;
record(
  "e06-06-shared-counter-stops-advancing-after-terminate",
  "counter frozen after terminate and exit",
  `stopped=${beaconAtStop} later=${beaconLater} result=${JSON.stringify(loopResult)}`,
  loopResult.ok === false && beaconAtStop > 0 && beaconLater === beaconAtStop,
);
await beaconPool.close();

const queuePool = createPool({ budgetMs: 4000, queueCap: 4 });
await queuePool.submit({ kind: "parse", docId: "warm", base64: smallDocument });
const inFlight = queuePool.submit({
  kind: "query",
  docId: "expensive",
  base64: quadraticDocument,
  expression: EXPENSIVE,
});
await sleep(50);
const queued = [];
for (let index = 0; index < 6; index += 1) {
  queued.push(
    queuePool.submit({
      kind: "parse",
      docId: `q${index}`,
      base64: smallDocument,
    }),
  );
}
const queuedResults = await Promise.all(queued);
const rejected = queuedResults.filter(
  (result) => result.ok === false && result.detail === "queue_full",
);
record(
  "e06-09-queue-overflow-rejects-immediately-beyond-cap",
  "submissions past the cap of 4 get resource_limit at once",
  JSON.stringify(queuedResults.map((r) => r.detail ?? "ok")),
  rejected.length === 2,
);
await inFlight;
await queuePool.close();

const cancelPool = createPool({ budgetMs: 4000, queueCap: 4 });
await cancelPool.submit({
  kind: "parse",
  docId: "warm",
  base64: smallDocument,
});
const spawnBefore = cancelPool.stats().spawnCount;
const blocking = cancelPool.submit({
  kind: "query",
  docId: "expensive",
  base64: quadraticDocument,
  expression: EXPENSIVE,
});
await sleep(50);
const controller = new AbortController();
const queuedCancel = cancelPool.submit(
  { kind: "parse", docId: "cancelled", base64: smallDocument },
  { signal: controller.signal },
);
await sleep(20);
controller.abort();
const cancelResult = await queuedCancel;
record(
  "e06-03-queued-cancellation-never-starts-work",
  "cancelled_in_queue and spawnCount unchanged",
  `${JSON.stringify(cancelResult)} spawn=${spawnBefore}->${cancelPool.stats().spawnCount}`,
  cancelResult.ok === false &&
    cancelResult.detail === "cancelled_in_queue" &&
    cancelPool.stats().spawnCount === spawnBefore,
);
await blocking;
await cancelPool.close();

const cursorPool = createPool({ budgetMs: 2000 });
await cursorPool.submit({ kind: "parse", docId: "doc", base64: smallDocument });
const snapshotId = cursorPool.mintSnapshot("doc");
const freshResolve = cursorPool.resolveSnapshot(snapshotId);
await cursorPool.terminate();
await cursorPool.submit({ kind: "parse", docId: "doc", base64: smallDocument });
const staleResolve = cursorPool.resolveSnapshot(snapshotId);
record(
  "e06-14-cursor-from-a-dead-generation-is-rejected",
  "fresh resolves, post-restart resolve is stale_cursor",
  `${JSON.stringify(freshResolve)} -> ${JSON.stringify(staleResolve)}`,
  freshResolve.ok === true && staleResolve.ok === false,
);
await cursorPool.close();

const drainPool = createPool({ budgetMs: 4000, queueCap: 4 });
await drainPool.submit({ kind: "parse", docId: "warm", base64: smallDocument });
const drainBlocking = drainPool.submit({
  kind: "query",
  docId: "expensive",
  base64: quadraticDocument,
  expression: EXPENSIVE,
});
await sleep(50);
const drainQueued = [
  drainPool.submit({ kind: "parse", docId: "d1", base64: smallDocument }),
  drainPool.submit({ kind: "parse", docId: "d2", base64: smallDocument }),
];
await sleep(20);
await drainPool.close();
const drained = await Promise.all(drainQueued);
await drainBlocking;
record(
  "e06-12-shutdown-settles-every-queued-promise",
  "each queued job rejects with a shutdown resource_limit, none dangles",
  JSON.stringify(drained.map((r) => `${r.code}:${r.detail}`)),
  drained.every(
    (result) => result.ok === false && result.code === "resource_limit",
  ),
);

const livePool = createPool({ budgetMs: 1200 });
await livePool.submit({ kind: "parse", docId: "warm", base64: smallDocument });
const heavy = livePool.submit({
  kind: "query",
  docId: "expensive",
  base64: quadraticDocument,
  expression: EXPENSIVE,
});
const loopStarted = performance.now();
await sleep(0);
metrics.mainLoopTurnMsWhilePathologicalRuns = Number(
  (performance.now() - loopStarted).toFixed(2),
);
record(
  "e06-15-main-event-loop-stays-live",
  "a main-thread turn completes in under 100 ms while a pathological job runs",
  String(metrics.mainLoopTurnMsWhilePathologicalRuns),
  metrics.mainLoopTurnMsWhilePathologicalRuns < 100,
);
await heavy;
await livePool.close();

const cyclePool = createPool({ budgetMs: 1000 });
let cycleFailures = 0;
for (let cycle = 0; cycle < 12; cycle += 1) {
  await cyclePool.terminate();
  const result = await cyclePool.submit({
    kind: "parse",
    docId: `cycle${cycle}`,
    base64: smallDocument,
  });
  if (result.ok !== true) cycleFailures += 1;
}
metrics.restartCycles = 12;
metrics.rssAfterCyclesKiB = Math.round(process.memoryUsage.rss() / 1024);
record(
  "e06-13-repeated-terminate-restart-converges",
  "every post-restart request succeeds",
  `failures=${cycleFailures} rssKiB=${metrics.rssAfterCyclesKiB}`,
  cycleFailures === 0,
);
await cyclePool.close();
await pool.close();

notes.push(
  "e06-05a mutlak esik yerine ayni host uzerindeki iki kolun oranini kullanir; yavas veya asiri yuklu bir runner'da mutlak CPU kesri duserken oran korunur. Negatif kontrol busy baseline kuramazsa sonuc 'inconclusive'dir, 'pass' degil.",
);
notes.push(
  "e06-05b negatif kontrolu e06-05a'nin duyarliligini kanitlar: terminate edilmeyen ayni is CPU'yu mesgul tutmaya devam ediyor, dolayisiyla terminate sonrasi dusuk CPU 'fixture kendiliginden bitti' ile aciklanamaz.",
);
limits.push(
  "CPU oracle'i host gurultusune duyarlidir; olcum tek thread'li ve bos ana thread ile alinir. SharedArrayBuffer beacon'i (e06-06) gurultuye bagisiz ikinci kanittir.",
);
limits.push(
  "Bu deney tek senkron parse'in kesilebildigini degil, thread'in oldugunu ve isin durdugunu kanitlar. WASM trap kurtarilabilirligi ve DOM disposal'i F0-07'de olculur.",
);

const failed = rows.filter((row) => row.pass === false);
console.log(
  JSON.stringify({
    schemaVersion: 1,
    task: "F0-06",
    probe: "worker-lifecycle",
    host: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpuCount: os.cpus().length,
      totalMemMiB: Math.round(os.totalmem() / 1024 / 1024),
      ci: process.env.CI === "true",
    },
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      execArgv: process.execArgv,
      maxRssUnit: "KiB",
    },
    engine: { name: "libxml2-wasm", specifier: "0.7.2", version: "0.7.2" },
    metrics,
    rows,
    summary: {
      total: rows.length,
      passed: rows.length - failed.length,
      failed: failed.length,
      requiresDecision: 0,
    },
    verdict: failed.length === 0 ? "pass" : "fail",
    blockingRows: failed.map((row) => row.id),
    limits,
    notes,
  }),
);
