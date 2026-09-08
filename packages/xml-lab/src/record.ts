import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type Sha256 = string & { readonly __sha256: unique symbol };
export type FixtureId = string & { readonly __fixtureId: unique symbol };

export type F0Task =
  "F0-01" | "F0-02" | "F0-03" | "F0-04" | "F0-05" | "F0-06" | "F0-07" | "F0-08";

export type Verdict = "pass" | "fail" | "inconclusive";

export interface HostRecord {
  readonly platform: string;
  readonly arch: string;
  readonly release: string;
  readonly cpuCount: number;
  readonly totalMemMiB: number;
  readonly ci: boolean;
}

export interface RuntimeRecord {
  readonly node: string;
  readonly v8: string;
  readonly execArgv: readonly string[];
  readonly maxRssUnit: "KiB" | "bytes" | "unknown";
}

export interface EngineRecord {
  readonly name: string;
  readonly specifier: string;
  readonly version: string;
  readonly lockfileIntegrity: string | null;
  readonly wrapperLicense: string | null;
  readonly embeddedLicenseFile: string | null;
  readonly embeddedLibxml2Version: string | null;
  readonly embeddedLibxml2VersionSource:
    "runtime-export" | "wasm-data-scan" | "upstream-pin" | "undetermined";
  readonly provenanceCommit: string | null;
  readonly reviewedRevision: string;
  readonly artifactMatchesReviewedRevision: boolean | null;
}

export interface CaseRow {
  readonly id: string;
  readonly expected: string;
  readonly actual: string;
  readonly pass: boolean;
}

export interface ProbeSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly requiresDecision: number;
}

export interface ProbeEnvelope<T extends F0Task, Row> {
  readonly schemaVersion: 1;
  readonly task: T;
  readonly probe: string;
  readonly host: HostRecord;
  readonly runtime: RuntimeRecord;
  readonly engine: EngineRecord;
  readonly rows: readonly Row[];
  readonly summary: ProbeSummary;
  readonly verdict: Verdict;
  readonly blockingRows: readonly string[];
  readonly limits: readonly string[];
  readonly notes: readonly string[];
}

export type SurfaceEnvelope = ProbeEnvelope<"F0-01", CaseRow>;

export type GenericEnvelope = ProbeEnvelope<F0Task, unknown>;

export interface LatencySummary {
  readonly p50: number;
  readonly p95: number;
}

export interface ConsumerMetrics {
  readonly installMs: number;
  readonly wasmCarrierBytes: number;
  readonly wasmCarrierSha256: string;
  readonly coldModuleImportMs: LatencySummary;
  readonly coldFirstParseMs: LatencySummary;
  readonly warmParseMs: LatencySummary & { readonly samples: number };
  readonly stderrBytesOnMalformed: number;
}

export type ConsumerEnvelope = ProbeEnvelope<"F0-02", CaseRow> & {
  readonly metrics: ConsumerMetrics;
};

export interface RunProbeOptions {
  readonly execArgv?: readonly string[];
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface ProbeOutcome {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function runProbe(
  probe: string,
  options: RunProbeOptions,
): ProbeOutcome {
  const script = fileURLToPath(
    new URL(`../test/probes/${probe}.mjs`, import.meta.url),
  );
  const child = spawnSync(
    process.execPath,
    [...(options.execArgv ?? []), script, ...(options.argv ?? [])],
    {
      encoding: "utf8",
      timeout: options.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 1 << 22,
      env: { ...process.env, ...options.env },
    },
  );
  return {
    status: child.status,
    signal: child.signal,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
  };
}

export function parseProbeRecord<T>(outcome: ProbeOutcome): T {
  const lines = outcome.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines.at(-1);
  if (last === undefined) {
    throw new Error(`probe produced no stdout. stderr:\n${outcome.stderr}`);
  }
  if (lines.length > 1) {
    throw new Error(
      `probe wrote ${lines.length} stdout lines; exactly one JSON line is required. stdout:\n${outcome.stdout}`,
    );
  }
  try {
    return JSON.parse(last) as T;
  } catch {
    throw new Error(`probe stdout is not JSON: ${last}`);
  }
}
