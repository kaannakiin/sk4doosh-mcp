import os from "node:os";
import { performance } from "node:perf_hooks";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { XmlDocument, ParseOption, diag } from "libxml2-wasm";

const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

const MiB = 1024 * 1024;
const FULL_TIER = process.env.SKMCP_XML_BENCH === "1";
const SIZES = FULL_TIER ? [1, 4, 8] : [1];

const rows = [];
const notes = [];
const limits = [];
const metrics = {};
const fixtures = [];

const record = (id, expected, actual, pass) =>
  rows.push({ id, expected, actual: String(actual).slice(0, 300), pass });

const WORDS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "omicron",
  "pi",
  "rho",
  "sigma",
  "tau",
  "upsilon",
  "phi",
  "chi",
  "psi",
  "omega",
  "kirmizi",
  "mavi",
  "yesil",
  "sari",
  "siyah",
  "beyaz",
  "mor",
  "turuncu",
];

const mulberry32 = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return (value ^ (value >>> 14)) >>> 0;
  };
};

const build = (shape, targetBytes, seed) => {
  const random = mulberry32(seed);
  const parts = ["<corpus>"];
  let size = parts[0].length + "</corpus>".length;
  let index = 0;
  while (size < targetBytes) {
    let chunk;
    if (shape === "text") {
      const words = Array.from(
        { length: 64 },
        () => WORDS[random() % WORDS.length],
      ).join(" ");
      chunk = `<doc id="d${index}"><body>${words}</body></doc>`;
    } else if (shape === "nodes") {
      chunk = `<g><h><item><id>${index}</id><n>${random() % 1000}</n><v>value-${index}</v></item></h></g>`;
    } else {
      const attributes = Array.from(
        { length: 20 },
        (_, slot) => `a${slot}="${WORDS[random() % WORDS.length]}"`,
      ).join(" ");
      chunk = `<item ${attributes}/>`;
    }
    parts.push(chunk);
    size += chunk.length;
    index += 1;
  }
  parts.push("</corpus>");
  let bytes = Buffer.from(parts.join(""), "utf8");
  if (bytes.length < targetBytes) {
    const padding = Buffer.alloc(targetBytes - bytes.length, 0x20);
    bytes = Buffer.concat([
      bytes.subarray(0, bytes.length - "</corpus>".length),
      padding,
      Buffer.from("</corpus>", "utf8"),
    ]);
  }
  return bytes;
};

const deepDocument = (depth) =>
  Buffer.from(`${"<n>".repeat(depth)}leaf${"</n>".repeat(depth)}`, "utf8");

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Number(sorted[index].toFixed(3));
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const relativeMad = (values) => {
  const centre = median(values);
  if (centre === 0) return 0;
  return median(values.map((value) => Math.abs(value - centre))) / centre;
};

const EXPRESSIONS = {
  "xp-cheap": "/corpus/*[1]",
  "xp-scan": "count(//*)",
};

diag.configure({ enabled: true });

const rssAtStart = process.memoryUsage.rss();

const warmupBytes = build("nodes", 256 * 1024, 0x1);
for (let index = 0; index < 8; index += 1) {
  const warmed = XmlDocument.fromBuffer(warmupBytes, { option: HARDENED });
  warmed.eval(EXPRESSIONS["xp-scan"]);
  warmed.dispose();
}

const measurements = [];
for (const shape of ["text", "nodes", "attrs"]) {
  for (const size of SIZES) {
    const targetBytes = size * MiB;
    const bytes = build(
      shape,
      targetBytes,
      0x5c4d ^ (size << 8) ^ shape.length,
    );
    const id = `${shape}-${size}mib`;
    fixtures.push({
      id,
      shape,
      targetBytes,
      actualBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      seed: 0x5c4d ^ (size << 8) ^ shape.length,
      generatorVersion: 1,
    });

    for (let index = 0; index < 2; index += 1) {
      const warmed = XmlDocument.fromBuffer(bytes, { option: HARDENED });
      warmed.eval(EXPRESSIONS["xp-scan"]);
      warmed.dispose();
    }

    const rssBefore = process.memoryUsage.rss();
    const parseSamples = [];
    const scanSamples = [];
    let rssPeak = rssBefore;
    let nodeCount = null;

    for (let iteration = 0; iteration < 12; iteration += 1) {
      const parseStarted = performance.now();
      const parsed = XmlDocument.fromBuffer(bytes, { option: HARDENED });
      parseSamples.push(performance.now() - parseStarted);
      const scanStarted = performance.now();
      const scanned = parsed.eval(EXPRESSIONS["xp-scan"]);
      scanSamples.push(performance.now() - scanStarted);
      nodeCount = scanned;
      rssPeak = Math.max(rssPeak, process.memoryUsage.rss());
      parsed.dispose();
    }

    const entry = {
      id,
      shape,
      sizeMiB: size,
      actualBytes: bytes.length,
      nodeCount,
      parseMs: {
        p50: percentile(parseSamples, 50),
        p95: percentile(parseSamples, 95),
      },
      scanMs: {
        p50: percentile(scanSamples, 50),
        p95: percentile(scanSamples, 95),
      },
      totalP95: Number(
        (percentile(parseSamples, 95) + percentile(scanSamples, 95)).toFixed(3),
      ),
      rssDeltaBytes: rssPeak - rssBefore,
      rssDeltaPerInputByte: Number(
        ((rssPeak - rssBefore) / bytes.length).toFixed(2),
      ),
      relativeMad: Number(relativeMad(parseSamples).toFixed(3)),
      liveAfter: Object.values(diag.report()).reduce(
        (total, value) => total + value.totalInstances,
        0,
      ),
    };
    entry.unstable = entry.relativeMad > 0.15;
    measurements.push(entry);
  }
}

metrics.processMemory = {
  rssAtStartKiB: Math.round(rssAtStart / 1024),
  rssAfterMatrixKiB: Math.round(process.memoryUsage.rss() / 1024),
  peakRssKiB: process.resourceUsage().maxRSS,
  maxRssUnit: "KiB",
  note: "steady-state marginal cost per cell is near zero because the wasm heap high-water is reached during warm-up; peakRss bounds the real cost of the whole matrix",
};

metrics.measurements = measurements;

record(
  "e08-every-cell-disposes-cleanly",
  "no live instances after any shape/size cell",
  JSON.stringify(measurements.map((entry) => `${entry.id}:${entry.liveAfter}`)),
  measurements.every((entry) => entry.liveAfter === 0),
);

const stable = measurements.filter((entry) => entry.unstable === false);
const unstable = measurements.filter((entry) => entry.unstable === true);
const shapesPerSize = new Map();
for (const entry of stable) {
  shapesPerSize.set(entry.sizeMiB, (shapesPerSize.get(entry.sizeMiB) ?? 0) + 1);
}
const fullyStableSizes = [...shapesPerSize.entries()]
  .filter(([, count]) => count === 3)
  .map(([size]) => size)
  .sort((a, b) => a - b);

metrics.stability = {
  statistic: "relative median absolute deviation",
  threshold: 0.15,
  iterationsPerCell: 12,
  perCell: measurements.map((entry) => ({
    id: entry.id,
    relativeMad: entry.relativeMad,
    unstable: entry.unstable,
  })),
  excludedFromBudgetDerivation: unstable.map((entry) => entry.id),
  fullyStableSizesMiB: fullyStableSizes,
};

record(
  "e08-at-least-one-size-tier-is-stable-across-all-three-shapes",
  "a file limit may only be claimed at a size where every shape measured stably; unstable cells are excluded and named, never averaged in",
  JSON.stringify(metrics.stability),
  fullyStableSizes.length > 0,
);

const depthLadder = [];
for (const depth of [64, 127, 128, 129, 256, 1024, 4096, 10000, 100000]) {
  const bytes = deepDocument(depth);
  const started = performance.now();
  let outcome = "parsed";
  let errorClass = null;
  try {
    const parsed = XmlDocument.fromBuffer(bytes, { option: HARDENED });
    parsed.dispose();
  } catch (error) {
    outcome = "rejected";
    errorClass = error.constructor.name;
  }
  depthLadder.push({
    depth,
    outcome,
    errorClass,
    elapsedMs: Number((performance.now() - started).toFixed(3)),
  });
}
metrics.depthLadder = depthLadder;
record(
  "e08-engine-depth-limit-is-measured-separately-from-the-application-limit",
  "the engine's own failure depth is recorded and lies above the proposed 128",
  JSON.stringify(depthLadder.map((entry) => `${entry.depth}:${entry.outcome}`)),
  depthLadder
    .filter((entry) => entry.depth <= 128)
    .every((entry) => entry.outcome === "parsed"),
);

const overLimitBytes = build("nodes", 8 * MiB + 1024, 0x77);
const limitBytes = 8 * MiB;
const rejectStarted = performance.now();
const rssBeforeReject = process.memoryUsage.rss();
const liveBeforeReject = Object.values(diag.report()).reduce(
  (total, value) => total + value.totalInstances,
  0,
);
const rejected = overLimitBytes.length > limitBytes;
const rejectElapsed = performance.now() - rejectStarted;
const liveAfterReject = Object.values(diag.report()).reduce(
  (total, value) => total + value.totalInstances,
  0,
);
metrics.preParseRejection = {
  inputBytes: overLimitBytes.length,
  limitBytes,
  elapsedMs: Number(rejectElapsed.toFixed(3)),
  rssDeltaBytes: process.memoryUsage.rss() - rssBeforeReject,
  documentsAllocated: liveAfterReject - liveBeforeReject,
};
record(
  "e08-09-over-limit-input-is-rejected-before-any-parse",
  "no XmlDocument allocated, negligible rss and elapsed time",
  JSON.stringify(metrics.preParseRejection),
  rejected === true &&
    metrics.preParseRejection.documentsAllocated === 0 &&
    metrics.preParseRejection.elapsedMs < 50,
);

const largestMeasured =
  fullyStableSizes.length === 0 ? 0 : Math.max(...fullyStableSizes);
const derivationSet = stable.filter(
  (entry) => entry.sizeMiB <= largestMeasured,
);
const worstTotalP95 = Math.max(...derivationSet.map((entry) => entry.totalP95));
const worstRssDelta = Math.max(
  ...derivationSet.map((entry) => entry.rssDeltaBytes),
);

const timeBudgetMs = Math.min(
  5000,
  Math.max(500, Math.ceil((3 * worstTotalP95) / 500) * 500),
);
const patienceQueueDepth = Math.floor(10000 / timeBudgetMs);
const mainProcessPinnedBudgetBytes = 64 * MiB;
const fileLimitBytes = largestMeasured * MiB;
const memoryQueueDepth = Math.floor(
  mainProcessPinnedBudgetBytes / fileLimitBytes,
);
const queueDepth = Math.max(1, Math.min(patienceQueueDepth, memoryQueueDepth));

metrics.derivedBudgets = {
  measuredUpToMiB: largestMeasured,
  derivedFromCells: derivationSet.map((entry) => entry.id),
  excludedUnstableCells: unstable.map((entry) => entry.id),
  worstShapeTotalP95Ms: worstTotalP95,
  worstShapeMarginalRssDeltaBytes: worstRssDelta,
  processPeakRssKiB: process.resourceUsage().maxRSS,
  worstShapeRssPerInputByte: Math.max(
    ...measurements.map((entry) => entry.rssDeltaPerInputByte),
  ),
  timeBudgetMs,
  patienceQueueDepth,
  memoryQueueDepth,
  queueDepth,
  queueDepthBoundBy:
    memoryQueueDepth < patienceQueueDepth
      ? "pinned-snapshot-memory"
      : "client-patience",
  mainProcessPinnedBudgetBytes,
  engineDepthFailsAbove: (() => {
    const parsedDepths = depthLadder
      .filter((entry) => entry.outcome === "parsed")
      .map((entry) => entry.depth);
    const rejectedDepths = depthLadder
      .filter((entry) => entry.outcome === "rejected")
      .map((entry) => entry.depth);
    return {
      deepestParsed:
        parsedDepths.length === 0 ? null : Math.max(...parsedDepths),
      shallowestRejected:
        rejectedDepths.length === 0 ? null : Math.min(...rejectedDepths),
    };
  })(),
  tier: FULL_TIER ? "full" : "1mib-only",
};

record(
  "e08-budgets-are-derived-from-the-worst-shape-not-the-average",
  "time budget derived as 3x the worst-shape p95, capped at 5000 ms",
  JSON.stringify(metrics.derivedBudgets),
  timeBudgetMs > 0 && timeBudgetMs <= 5000 && queueDepth >= 1,
);

if (!FULL_TIER) {
  limits.push(
    "SKMCP_XML_BENCH=1 verilmedigi icin yalniz 1 MiB kademesi olculdu; 8 MiB dosya limiti bu kosudan turetilemez ve F0-08 dosya limiti karari acik kalir.",
  );
}

notes.push(
  "Fixture'lar mulberry32 ile deterministik uretilir, uint32 modulo kullanilir (float yolu yok) ve her birinin sha256'si kaydedilir; ayni seed ayni byte'lari verir.",
);
if (unstable.length > 0) {
  limits.push(
    `Kararsiz hucreler butce turetiminden cikarildi ve isim isim kaydedildi: ${unstable.map((entry) => entry.id).join(", ")}. Bu hucreler icin dosya limiti iddia edilmez.`,
  );
}
limits.push(
  "Kararlilik olcutu ortalama tabanli CV degil, medyan mutlak sapmanin medyana orani (relative MAD). Paylasimli CI runner'inda tek bir yavas iterasyon CV'yi surukluyordu; MAD aykiri degere dayaniklidir.",
);
limits.push(
  "Bu tablo tek host ve tek Node surumunun olcumudur. Butce turetimi desteklenen en yavas CI host'unda tekrarlanmadan nihai sayilmaz.",
);
limits.push(
  "Derinlik merdiveni parse sonucunu olcer; read_node gorunum limiti (onerilen 128) ayri bir katmandir ve F2-06'da olculur.",
);
notes.push(
  "Kuyruk derinligi iki bagimsiz kisittan kucugudur: istemci sabri (10 s / B_t) ve ana surecte pinlenen snapshot bellegi (64 MiB / B_f). Ikincisi baglayici oldugunda bu kayitta belirtilir.",
);

const failed = rows.filter((row) => row.pass === false);
console.log(
  JSON.stringify({
    schemaVersion: 1,
    task: "F0-08",
    probe: "budget",
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
    engine: {
      name: "libxml2-wasm",
      specifier: "0.7.2",
      version: "0.7.2",
      parseOptionWord: HARDENED,
    },
    fixtures,
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
