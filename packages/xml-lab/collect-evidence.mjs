import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runProbe, parseProbeRecord } from "./src/record.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const outputDirectory = join(repoRoot, "docs", "xml", "f0");

const git = (...args) => {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
};

const provenance = {
  commit: git("rev-parse", "HEAD"),
  workingTreeDirty: git("status", "--porcelain") !== "",
  githubRunId: process.env.GITHUB_RUN_ID ?? null,
  githubRunUrl:
    process.env.GITHUB_RUN_ID === undefined
      ? null
      : `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
};

const probes = [
  {
    task: "F0-01",
    probe: "surface",
    file: "f0-01-surface.json",
    options: { timeoutMs: 60_000 },
    command: "node packages/xml-lab/test/probes/surface.mjs",
  },
  {
    task: "F0-02",
    probe: "isolated-consumer",
    file: "f0-02-consumer.json",
    options: { timeoutMs: 300_000 },
    command: "node packages/xml-lab/test/probes/isolated-consumer.mjs",
    skip: process.env.SKMCP_XML_F0_NO_NETWORK === "1",
  },
  {
    task: "F0-03",
    probe: "namespace",
    file: "f0-03-semantics.json",
    options: { execArgv: ["--max-old-space-size=768"], timeoutMs: 240_000 },
    command: "node packages/xml-lab/test/probes/namespace.mjs",
  },
  {
    task: "F0-04",
    probe: "encoding",
    file: "f0-04-encoding-matrix.json",
    options: { execArgv: ["--max-old-space-size=768"], timeoutMs: 240_000 },
    command: "node packages/xml-lab/test/probes/encoding.mjs",
  },
  {
    task: "F0-05",
    probe: "security",
    file: "f0-05-security.json",
    options: { execArgv: ["--max-old-space-size=768"], timeoutMs: 240_000 },
    command: "node packages/xml-lab/test/probes/security.mjs",
  },
  {
    task: "F0-06",
    probe: "worker-lifecycle",
    file: "f0-06-worker.json",
    options: { execArgv: ["--max-old-space-size=1536"], timeoutMs: 900_000 },
    command: "node packages/xml-lab/test/probes/worker-lifecycle.mjs",
  },
  {
    task: "F0-07",
    probe: "resource-lifetime",
    file: "f0-07-lifetime.json",
    options: {
      execArgv: ["--expose-gc", "--max-old-space-size=1536"],
      timeoutMs: 300_000,
    },
    command:
      "node --expose-gc packages/xml-lab/test/probes/resource-lifetime.mjs",
  },
  {
    task: "F0-08",
    probe: "budget",
    file: "f0-08-measurements.json",
    options: { execArgv: ["--max-old-space-size=3072"], timeoutMs: 420_000 },
    command:
      "SKMCP_XML_BENCH=1 node --max-old-space-size=3072 packages/xml-lab/test/probes/budget.mjs",
  },
  {
    task: "F2-10",
    probe: "residency",
    file: "f2-10-residency.json",
    options: {
      execArgv: ["--expose-gc", "--max-old-space-size=3072"],
      timeoutMs: 600_000,
    },
    command:
      "SKMCP_XML_BENCH=1 node --expose-gc packages/xml-lab/test/probes/residency.mjs",
  },
];

mkdirSync(outputDirectory, { recursive: true });

let failed = 0;
for (const entry of probes) {
  if (entry.skip === true) {
    process.stderr.write(`${entry.task} not run (SKMCP_XML_F0_NO_NETWORK=1)\n`);
    continue;
  }
  const outcome = runProbe(entry.probe, entry.options);
  if (outcome.status !== 0) {
    failed += 1;
    const reason =
      outcome.signal === "SIGKILL"
        ? "timed out; on a contended host the wall clock inflates far beyond the cpu time, so re-run on an idle host before treating this as a defect"
        : "exited non-zero";
    process.stderr.write(
      `${entry.task} ${reason} (status ${outcome.status}, signal ${outcome.signal})\n${outcome.stderr}\n`,
    );
    continue;
  }
  const record = parseProbeRecord(outcome);
  const enriched = { ...record, provenance, command: entry.command };
  const target = join(outputDirectory, entry.file);
  writeFileSync(target, `${JSON.stringify(enriched, null, 2)}\n`);
  if (record.verdict === "fail") failed += 1;
  const marker = record.verdict === "inconclusive" ? " [INCONCLUSIVE]" : "";
  process.stderr.write(
    `${entry.task} ${record.verdict}${marker} (${record.summary.passed}/${record.summary.total}) -> ${target}\n`,
  );
}

process.exit(failed === 0 ? 0 : 1);
