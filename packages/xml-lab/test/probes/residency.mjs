import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { XmlDocument, ParseOption, diag } from "libxml2-wasm";

const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

const FULL_TIER = process.env.SKMCP_XML_BENCH === "1";
const MAD_CEILING = 0.15;

const rows = [];
const notes = [];
const limits = [];
const metrics = {};

const record = (id, expected, actual, pass) =>
  rows.push({ id, expected, actual: String(actual).slice(0, 300), pass });

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const relativeMad = (values) => {
  const centre = median(values);
  if (centre === 0) return Infinity;
  return median(values.map((value) => Math.abs(value - centre))) / centre;
};

const armPath = fileURLToPath(new URL("./residency-arm.mjs", import.meta.url));
const SHAPES = ["flat", "attributes", "deep"];
const RESIDENCY = FULL_TIER ? 9 : 5;

/**
 * Linear memory is never returned to the OS and a disposed document leaves free
 * space behind it, so a second shape measured in the same process allocates into
 * that space and reads a marginal cost of zero. Each shape gets its own process.
 */
function runArm(shape) {
  const outcome = spawnSync(
    process.execPath,
    ["--expose-gc", armPath, shape, String(RESIDENCY)],
    { encoding: "utf8", timeout: 180_000, maxBuffer: 1 << 22 },
  );
  if (outcome.status !== 0) {
    return { failed: true, stderr: String(outcome.stderr).slice(0, 300) };
  }
  return JSON.parse(outcome.stdout);
}

for (const shape of SHAPES) {
  const arm = runArm(shape);
  if (arm.failed === true) {
    metrics[shape] = { unstable: true, coefficient: null, error: arm.stderr };
    record(
      `f210-${shape}-coefficient-measured`,
      "a stable marginal RSS cost per resident document",
      "arm failed",
      false,
    );
    notes.push(`${shape} arm exited non-zero: ${arm.stderr}`);
    continue;
  }

  const deltas = arm.marginalDeltas;
  const centre = median(deltas);
  const spread = relativeMad(deltas);
  const unstable = !Number.isFinite(spread) || spread > MAD_CEILING || centre <= 0;
  const coefficient = unstable
    ? null
    : Number((centre / arm.sourceBytes).toFixed(2));

  metrics[shape] = {
    sourceBytes: arm.sourceBytes,
    residency: arm.residency,
    marginalDeltas: deltas,
    medianMarginalBytes: centre,
    relativeMad: Number.isFinite(spread) ? Number(spread.toFixed(4)) : null,
    unstable,
    coefficient,
  };

  if (unstable) {
    notes.push(
      `${shape} was unstable (relative MAD ${String(spread)}, median ${String(centre)}) and is excluded from the derivation`,
    );
  }

  record(
    `f210-${shape}-coefficient-measured`,
    "a stable marginal RSS cost per resident document",
    coefficient === null ? "inconclusive" : coefficient,
    coefficient !== null,
  );
}

/**
 * diag costs 24,9% (F1 closure), so it stays off while the arms measure and only
 * arms here, over documents this process allocates itself. Reading an empty
 * report would make the row pass without measuring anything.
 */
diag.configure({ enabled: true });
const disposalSource = Buffer.from(
  `<w>${"<i>value</i>".repeat(200)}</w>`,
  "utf8",
);
const disposalRounds = 5;
const liveOf = () =>
  Object.values(diag.report() ?? {}).reduce(
    (total, entry) => total + entry.totalInstances,
    0,
  );

const tracked = [];
for (let round = 0; round < disposalRounds; round += 1) {
  tracked.push(XmlDocument.fromBuffer(disposalSource, { option: HARDENED }));
}
const liveWhileHeld = liveOf();
for (const parsed of tracked) parsed.dispose();
const liveAfterDispose = liveOf();

record(
  "f210-disposal-oracle-sees-a-held-document",
  `${String(disposalRounds)} live instances while held`,
  liveWhileHeld,
  liveWhileHeld >= disposalRounds,
);
record(
  "f210-every-document-disposed",
  "0 live instances after dispose",
  liveAfterDispose,
  liveAfterDispose === 0,
);

metrics.processMemory = {
  rssAfterMatrixKiB: Math.round(process.memoryUsage.rss() / 1024),
  peakRssKiB: process.resourceUsage().maxRSS,
  maxRssUnit: "KiB",
};

limits.push(
  "RSS is a process-level measurement and includes allocator high-water marks; it bounds the budget, it does not enforce it.",
  "worker.resourceLimits bounds the JS heap and not WASM linear memory (K5), so exceeding this budget is process death, not a clean resource_limit.",
);
notes.push(
  "The coefficient is RSS delta divided by source bytes times residency, so documentCacheSize S of an 8 MiB document costs roughly S * 8 MiB * coefficient.",
);

const failed = rows.filter((row) => !row.pass);
const measurable = SHAPES.every(
  (shape) => metrics[shape].coefficient !== null,
);

process.stdout.write(
  JSON.stringify({
    schemaVersion: 1,
    task: "F2-10",
    probe: "residency",
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
    metrics,
    rows,
    summary: {
      total: rows.length,
      passed: rows.length - failed.length,
      failed: failed.length,
      requiresDecision: 0,
    },
    measurable,
    verdict: failed.length > 0 ? "fail" : measurable ? "pass" : "inconclusive",
    blockingRows: failed.map((row) => row.id),
    limits,
    notes,
  }),
);
