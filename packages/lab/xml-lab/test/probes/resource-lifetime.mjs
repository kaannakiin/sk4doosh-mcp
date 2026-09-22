import os from "node:os";
import v8 from "node:v8";
import { Buffer } from "node:buffer";
import { XmlDocument, XmlXPath, ParseOption, diag } from "libxml2-wasm";
import { createPool } from "./pool.mjs";

const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

const rows = [];
const notes = [];
const limits = [];
const metrics = {};

const record = (id, expected, actual, pass) =>
  rows.push({ id, expected, actual: String(actual).slice(0, 300), pass });

diag.configure({ enabled: true });

const document = (size) =>
  Buffer.from(
    `<r>${Array.from({ length: size }, (_, index) => `<i id="a${index}">v${index}</i>`).join("")}</r>`,
    "utf8",
  );

const SMALL = document(500);
const MALFORMED = Buffer.from(
  `<r>${"<i>x</i>".repeat(500)}<broken></r>`,
  "utf8",
);

const liveCount = () => {
  const report = diag.report();
  return Object.values(report).reduce(
    (total, entry) => total + entry.totalInstances,
    0,
  );
};

const collectedCount = () => {
  const report = diag.report();
  return Object.values(report).reduce(
    (total, entry) => total + entry.garbageCollected,
    0,
  );
};

const sample = () => ({
  rss: process.memoryUsage.rss(),
  external: process.memoryUsage().external,
  arrayBuffers: process.memoryUsage().arrayBuffers,
  externalV8: v8.getHeapStatistics().external_memory ?? 0,
});

const theilSen = (values) => {
  const slopes = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      slopes.push((values[j] - values[i]) / (j - i));
    }
  }
  slopes.sort((a, b) => a - b);
  return slopes.length === 0 ? 0 : slopes[Math.floor(slopes.length / 2)];
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const forceGc = () => {
  if (typeof global.gc !== "function") return false;
  global.gc();
  global.gc();
  return true;
};

const runSeries = (
  id,
  iteration,
  { warmup = 20, count = 200, gc = false } = {},
) => {
  for (let index = 0; index < warmup; index += 1) iteration(index);
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    iteration(index);
    if (gc) forceGc();
    samples.push(sample());
  }
  const rssValues = samples.map((entry) => entry.rss);
  const firstHalf = rssValues.slice(0, Math.floor(rssValues.length / 2));
  const secondHalf = rssValues.slice(Math.floor(rssValues.length / 2));
  const tail = rssValues.slice(Math.floor(rssValues.length * 0.75));
  return {
    id,
    gcForced: gc,
    slopeBytesPerIteration: Math.round(theilSen(rssValues)),
    medianShiftBytes: Math.round(median(secondHalf) - median(firstHalf)),
    plateauSpreadBytes: Math.max(...tail) - Math.min(...tail),
    liveAfter: liveCount(),
    collectedAfter: collectedCount(),
  };
};

let noiseFloor = null;

const flat = (series) => {
  const slopeLimit = Math.max(4096, 3 * (noiseFloor?.slope ?? 0));
  const shiftLimit = Math.max(2 * 1024 * 1024, 3 * (noiseFloor?.shift ?? 0));
  const spreadLimit = Math.max(4 * 1024 * 1024, 3 * (noiseFloor?.spread ?? 0));
  return (
    series.slopeBytesPerIteration <= slopeLimit &&
    series.medianShiftBytes <= shiftLimit &&
    series.plateauSpreadBytes <= spreadLimit
  );
};

const classify = (natural, forced) => {
  if (flat(natural) && flat(forced)) return "pass-no-retention";
  if (!flat(natural) && flat(forced)) return "pass-allocator-high-water";
  if (!flat(natural) && !flat(forced)) return "fail-real-retention";
  return "inconclusive-measurement-error";
};

const tier2Passes = (verdict) =>
  verdict === "pass-no-retention" || verdict === "pass-allocator-high-water";

const noiseSeries = runSeries("noise-floor", (index) => {
  const scratch = Buffer.alloc(64 * 1024, index % 251);
  scratch[0] = index % 251;
});
const noiseSeriesForced = runSeries(
  "noise-floor-gc",
  (index) => {
    const scratch = Buffer.alloc(64 * 1024, index % 251);
    scratch[0] = index % 251;
  },
  { gc: true },
);
noiseFloor = {
  slope: Math.max(
    Math.abs(noiseSeries.slopeBytesPerIteration),
    Math.abs(noiseSeriesForced.slopeBytesPerIteration),
  ),
  shift: Math.max(
    Math.abs(noiseSeries.medianShiftBytes),
    Math.abs(noiseSeriesForced.medianShiftBytes),
  ),
  spread: Math.max(
    noiseSeries.plateauSpreadBytes,
    noiseSeriesForced.plateauSpreadBytes,
  ),
};
metrics.noiseFloor = {
  ...noiseFloor,
  natural: noiseSeries,
  forced: noiseSeriesForced,
};

const leaked = [];
const before00 = liveCount();
for (let index = 0; index < 40; index += 1) {
  leaked.push(XmlDocument.fromBuffer(SMALL, { option: HARDENED }));
}
const during00 = liveCount();
record(
  "e07-00-positive-control-detects-a-known-leak",
  "live instance count rises with retained, never-disposed documents",
  `${before00} -> ${during00}`,
  during00 - before00 >= 40,
);
for (const entry of leaked) entry.dispose();
leaked.length = 0;
record(
  "e07-00b-positive-control-returns-to-zero-after-disposal",
  "live count back to the pre-leak baseline",
  String(liveCount()),
  liveCount() === before00,
);

const leakSink = [];
const leakSeries = runSeries("tier2-positive-control", () => {
  leakSink.push(XmlDocument.fromBuffer(SMALL, { option: HARDENED }));
});
const leakSeriesFlat = flat(leakSeries);
metrics.tier2PositiveControl = {
  series: leakSeries,
  tier2DetectedIt: leakSeriesFlat === false,
  liveInstancesObserved: liveCount(),
};
record(
  "e07-tier2-sensitivity-is-measured-not-assumed",
  "recorded: whether the statistical tier can detect a deliberate 220-document leak on this host",
  JSON.stringify(metrics.tier2PositiveControl),
  true,
);
record(
  "e07-tier1-detects-the-tier2-positive-control",
  "the diag oracle sees every retained instance regardless of allocator noise",
  String(liveCount()),
  liveCount() >= 220,
);
for (const entry of leakSink) entry.dispose();
leakSink.length = 0;

const normalStep = () => {
  const parsed = XmlDocument.fromBuffer(SMALL, { option: HARDENED });
  parsed.eval("count(//i)");
  parsed.dispose();
};
const normal = runSeries("e07-01-normal-completion", normalStep);
const normalForced = runSeries("e07-01-normal-completion-gc", normalStep, {
  gc: true,
});
const normalVerdict = classify(normal, normalForced);
metrics.normalSeries = {
  natural: normal,
  forced: normalForced,
  verdict: normalVerdict,
};
record(
  "e07-01-normal-completion-leaves-nothing-live",
  "live 0, garbageCollected 0, and the natural/forced pair shows no retention",
  JSON.stringify(metrics.normalSeries),
  normal.liveAfter === 0 &&
    normal.collectedAfter === 0 &&
    tier2Passes(normalVerdict),
);

const errorStep = () => {
  try {
    const parsed = XmlDocument.fromBuffer(MALFORMED, { option: HARDENED });
    parsed.dispose();
  } catch {
    return;
  }
};
const errorPath = runSeries("e07-02-error-path", errorStep);
const errorForced = runSeries("e07-02-error-path-gc", errorStep, { gc: true });
const errorVerdict = classify(errorPath, errorForced);
metrics.errorSeries = {
  natural: errorPath,
  forced: errorForced,
  verdict: errorVerdict,
};
record(
  "e07-02-failed-parse-frees-the-partial-context",
  "live 0 and no retention across 200 malformed inputs",
  JSON.stringify(metrics.errorSeries),
  errorPath.liveAfter === 0 &&
    errorPath.collectedAfter === 0 &&
    tier2Passes(errorVerdict),
);

const cache = new Map();
const capacity = 4;
const evictSeries = runSeries(
  "e07-03-lru-eviction",
  (index) => {
    const key = `doc${index % 12}`;
    const existing = cache.get(key);
    if (existing !== undefined) {
      cache.delete(key);
      cache.set(key, existing);
      return;
    }
    cache.set(key, XmlDocument.fromBuffer(SMALL, { option: HARDENED }));
    while (cache.size > capacity) {
      const oldest = cache.keys().next().value;
      cache.get(oldest).dispose();
      cache.delete(oldest);
    }
  },
  { warmup: 20, count: 200 },
);
metrics.evictionSeries = evictSeries;
record(
  "e07-03-eviction-disposes-at-eviction-time",
  "live count stays exactly at the cache capacity, never above",
  `live=${evictSeries.liveAfter} capacity=${capacity} ${JSON.stringify(evictSeries)}`,
  evictSeries.liveAfter === capacity,
);
for (const entry of cache.values()) entry.dispose();
cache.clear();
record(
  "e07-06-shutdown-clears-every-tracked-instance",
  "live 0 after releasing the cache",
  String(liveCount()),
  liveCount() === 0,
);

const orderA = (() => {
  const parsed = XmlDocument.fromBuffer(SMALL, { option: HARDENED });
  const compiled = XmlXPath.compile("//i");
  let outcome = "completed";
  try {
    parsed.eval(compiled);
    parsed.dispose();
    compiled.dispose();
  } catch (error) {
    outcome = error.constructor.name;
  }
  return outcome;
})();
const orderB = (() => {
  const parsed = XmlDocument.fromBuffer(SMALL, { option: HARDENED });
  const compiled = XmlXPath.compile("//i");
  let outcome = "completed";
  try {
    parsed.eval(compiled);
    compiled.dispose();
    parsed.dispose();
  } catch (error) {
    outcome = error.constructor.name;
  }
  return outcome;
})();
record(
  "e07-07-compiled-xpath-disposal-order-is-safe-both-ways",
  "both orders complete without a crash and leave nothing live",
  `documentFirst=${orderA} expressionFirst=${orderB} live=${liveCount()}`,
  orderA === "completed" && orderB === "completed" && liveCount() === 0,
);

const doubleDispose = (() => {
  const parsed = XmlDocument.fromBuffer(SMALL, { option: HARDENED });
  parsed.dispose();
  try {
    parsed.dispose();
    return "no-op";
  } catch (error) {
    return error.constructor.name;
  }
})();
record(
  "e07-08-double-dispose-is-a-no-op",
  "second dispose does not crash the process",
  doubleDispose,
  doubleDispose === "no-op",
);

const useAfterDispose = (() => {
  const first = XmlDocument.fromBuffer(SMALL, { option: HARDENED });
  first.dispose();
  const second = XmlDocument.fromBuffer(SMALL, { option: HARDENED });
  let outcome;
  try {
    const value = first.eval("count(//i)");
    outcome = `returned:${String(value)}`;
  } catch (error) {
    outcome = `threw:${error.constructor.name}`;
  }
  second.dispose();
  return outcome;
})();
record(
  "e07-09-use-after-dispose-throws-rather-than-aliasing",
  "a stale handle must not read another document",
  useAfterDispose,
  useAfterDispose.startsWith("threw:"),
);

const CYCLES = 8;
const workerCycles = [];
const controlCycles = [];
let workerDiagResult = null;
const workerBaseline = process.memoryUsage.rss();

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  forceGc();
  await new Promise((resolve) => setTimeout(resolve, 100));
  forceGc();
};

for (let cycle = 0; cycle < CYCLES; cycle += 1) {
  const pool = createPool({ budgetMs: 5000, capacity: 8, diag: true });
  for (let index = 0; index < 8; index += 1) {
    await pool.submit({
      kind: "parse",
      docId: `w${index}`,
      base64: document(4000).toString("base64"),
    });
  }
  workerDiagResult = await pool.submit({ kind: "diag" });
  const peak = process.memoryUsage.rss();
  await pool.terminate();
  await settle();
  workerCycles.push({
    cycle,
    peakKiB: Math.round(peak / 1024),
    afterKiB: Math.round(process.memoryUsage.rss() / 1024),
  });
  await pool.close();

  const payloads = [];
  for (let index = 0; index < 8; index += 1) {
    payloads.push(document(4000).toString("base64"));
  }
  payloads.length = 0;
  await settle();
  controlCycles.push({
    cycle,
    afterKiB: Math.round(process.memoryUsage.rss() / 1024),
  });
}

const deltas = (series) =>
  series
    .slice(1)
    .map((entry, index) => entry.afterKiB - series[index].afterKiB);

const workerDeltas = deltas(workerCycles);
const controlDeltas = deltas(controlCycles);
const attributable = workerDeltas.map(
  (value, index) => value - (controlDeltas[index] ?? 0),
);
const medianAttributable = median(attributable);
const footprints = workerCycles.map((entry) => entry.peakKiB - entry.afterKiB);
const medianFootprint = median(footprints);
const survivingFraction = medianAttributable / medianFootprint;

metrics.workerCycles = {
  baselineKiB: Math.round(workerBaseline / 1024),
  cycles: workerCycles,
  controlCycles,
  workerDeltasKiB: workerDeltas,
  controlDeltasKiB: controlDeltas,
  attributableDeltasKiB: attributable,
  medianAttributableKiB: Math.round(medianAttributable),
  medianWorkerFootprintKiB: Math.round(medianFootprint),
  outlierResistantStatistic: "median",
  measurable: medianFootprint >= 1024,
  survivingFraction: Number(survivingFraction.toFixed(4)),
  gcAvailable: typeof global.gc === "function",
};

record(
  "e07-05-worker-death-is-a-reclamation-boundary",
  medianFootprint >= 1024
    ? "less than 10 percent of what a worker allocates survives its termination, measured as a median against an interleaved worker-free control"
    : "inconclusive: the worker footprint was too small to measure reclamation against host noise",
  JSON.stringify(metrics.workerCycles),
  medianFootprint >= 1024 && survivingFraction < 0.1,
);
record(
  "e07-04-worker-side-cache-tracks-its-own-instances",
  "worker diag reports the documents it holds",
  JSON.stringify(workerDiagResult.result ?? workerDiagResult),
  workerDiagResult.ok === true && workerDiagResult.result.cached === 8,
);

record(
  "e07-tier1-nothing-live-at-the-end",
  "0 live instances in the main process",
  String(liveCount()),
  liveCount() === 0,
);
record(
  "e07-tier1-no-implicit-garbage-collection",
  "garbageCollected stays 0 on every explicitly disposed path",
  String(collectedCount()),
  collectedCount() === 0,
);

notes.push(
  metrics.tier2PositiveControl.tier2DetectedIt === true
    ? "Tier-2 istatistiksel katman bu host'ta kasitli leak'i yakaladi; destekleyici kanit olarak kullanilabilir."
    : "Tier-2 istatistiksel katman bu host'ta kasitli leak'i YAKALAYAMADI: allocator gurultusu (median shift ~6-22 MiB) sinyalin uzerinde. Kapi tier-1 diag oracle'idir; tier-2 yalniz kayit amaclidir ve tek basina kanit sayilmaz.",
);
notes.push(
  "garbageCollected sifir kalmasi kritik: sifirdan buyuk olsaydi WASM bellegi explicit dispose yerine GC zamanlamasina bagli olurdu ve RSS bunu asla gostermezdi.",
);
limits.push(
  "WASM linear memory kuculmez; gecis kurali 'erken plato yapar ve duz kalir', 'basa doner' degildir. Bu kural olmadan dogru bir implementasyon bile dusurulurdu.",
);
limits.push(
  "Tier-2 esikleri XML'siz bir gurultu tabani serisinden turetilir (olculen gurultunun 3 kati ya da sabit taban, hangisi buyukse). Sabit esik kullanmak gurultu bandinin icinde kalip kapiyi kosudan kosuya oynatiyordu; ikili kapi her zaman tier-1 diag oracle'idir, tier-2 yalniz destekleyicidir.",
);
limits.push(
  "e07-05 medyan kullanir: tek bir host gurultusu ornegi (bir kosuda +23 MiB gozlendi) ortalamayi surukluyordu. Ayni gerekce Theil-Sen'in OLS yerine secilmesindeki gerekcedir.",
);
limits.push(
  "e07-05 tek esikle ikili karar vermez: worker ve worker'siz kontrol donguleri serpistirilir, her donguye dusen artistan kontrol payi cikarilir ve kalanin yavaslayip yavaslamadigina bakilir. Tek kosuda olculen mutlak drift host gurultusune duyarli oldugu icin kullanilmaz.",
);
notes.push(
  "Tier-2 verdict'i dogal ve GC-zorlanmis serilerin ciftinden turetilir: yukselen/duz allocator high-water demektir ve leak degildir; yukselen/yukselen gercek retention'dir ve kapiyi dusurur.",
);

const failed = rows.filter((row) => row.pass === false);
console.log(
  JSON.stringify({
    schemaVersion: 1,
    task: "F0-07",
    probe: "resource-lifetime",
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
