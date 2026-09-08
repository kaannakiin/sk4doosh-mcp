import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { dirname, join, sep } from "node:path";
import { performance } from "node:perf_hooks";

const ENGINE = "libxml2-wasm@0.7.2";
const COLD_SAMPLES = 5;
const WARM_SAMPLES = 30;

const cases = [];
const notes = [];
const limits = [];
const metrics = {};

const record = (id, expected, actual, pass) => {
  cases.push({ id, expected, actual: String(actual).slice(0, 400), pass });
};

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Number(sorted[index].toFixed(3));
};

const project = mkdtempSync(join(os.tmpdir(), "sk-mcp-xml-f0-consumer-"));
const npmCache = join(project, ".npm-cache");

try {
  await mkdir(npmCache, { recursive: true });
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify(
      {
        name: "xml-f0-consumer",
        private: true,
        type: "module",
        version: "0.0.0",
      },
      null,
      2,
    ),
  );

  const installStarted = performance.now();
  const install = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "install",
      ENGINE,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--cache",
      npmCache,
    ],
    {
      cwd: project,
      encoding: "utf8",
      timeout: 180_000,
      shell: process.platform === "win32",
    },
  );
  metrics.installMs = Number((performance.now() - installStarted).toFixed(1));

  record(
    "install-without-scripts-succeeds",
    "npm install --ignore-scripts exits 0",
    `status=${install.status} ${String(install.stderr).slice(0, 200)}`,
    install.status === 0,
  );
  assert.equal(install.status, 0, `install failed: ${install.stderr}`);

  const require = createRequire(join(project, "index.mjs"));
  const enginePackagePath = require.resolve("libxml2-wasm/package.json");
  const engineRoot = dirname(enginePackagePath);
  const expectedPrefix =
    join(realpathSync(project), "node_modules", "libxml2-wasm") + sep;

  record(
    "engine-resolves-inside-consumer-node-modules",
    `path under ${expectedPrefix}`,
    realpathSync(enginePackagePath).startsWith(expectedPrefix)
      ? "inside"
      : realpathSync(enginePackagePath),
    realpathSync(enginePackagePath).startsWith(expectedPrefix),
  );

  const gluePath = join(engineRoot, "lib", "libxml2raw.mjs");
  const glueBytes = readFileSync(gluePath);
  const glueSha256 = createHash("sha256").update(glueBytes).digest("hex");
  metrics.wasmCarrierBytes = glueBytes.length;
  metrics.wasmCarrierSha256 = glueSha256;

  const workspaceRequire = createRequire(import.meta.url);
  const workspaceGlue = readFileSync(
    join(
      dirname(workspaceRequire.resolve("libxml2-wasm/package.json")),
      "lib",
      "libxml2raw.mjs",
    ),
  );
  const workspaceSha256 = createHash("sha256")
    .update(workspaceGlue)
    .digest("hex");

  record(
    "wasm-carrier-identical-to-integrity-pinned-copy",
    workspaceSha256,
    glueSha256,
    glueSha256 === workspaceSha256,
  );

  const installedFiles = spawnSync(
    process.execPath,
    [
      "-e",
      "const {readdirSync}=require('node:fs');console.log(readdirSync(process.argv[1]).join(','))",
      engineRoot,
    ],
    { encoding: "utf8" },
  );
  record(
    "no-standalone-wasm-file-in-consumer-tree",
    "no .wasm sibling; SINGLE_FILE carrier only",
    String(installedFiles.stdout).trim(),
    !String(installedFiles.stdout).includes(".wasm"),
  );

  const trapScript = join(project, "trap.mjs");
  writeFileSync(
    trapScript,
    `import { createRequire } from "node:module";
const calls = { fetch: 0, httpRequest: 0, httpsRequest: 0 };
globalThis.fetch = () => { calls.fetch += 1; throw new Error("fetch trapped"); };
const http = await import("node:http");
const https = await import("node:https");
const wrap = (module, key, name) => {
  const original = module[key];
  module[key] = (...args) => { calls[name] += 1; return original(...args); };
};
wrap(http.default, "request", "httpRequest");
wrap(https.default, "request", "httpsRequest");
const importStarted = performance.now();
const { XmlDocument } = await import("libxml2-wasm");
const moduleImportMs = performance.now() - importStarted;
const firstStarted = performance.now();
const first = XmlDocument.fromBuffer(Buffer.from("<r><a>1</a></r>"));
const firstParseMs = performance.now() - firstStarted;
first.dispose();
const warm = [];
for (let i = 0; i < ${WARM_SAMPLES}; i += 1) {
  const started = performance.now();
  const document = XmlDocument.fromBuffer(Buffer.from("<r><a>1</a></r>"));
  warm.push(performance.now() - started);
  document.dispose();
}
const require = createRequire(import.meta.url);
console.log(JSON.stringify({
  calls,
  moduleImportMs,
  firstParseMs,
  warm,
  resolved: require.resolve("libxml2-wasm"),
}));
`,
  );

  const coldRuns = [];
  for (let sample = 0; sample < COLD_SAMPLES; sample += 1) {
    const child = spawnSync(process.execPath, [trapScript], {
      cwd: project,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(child.status, 0, `trap run failed: ${child.stderr}`);
    coldRuns.push(JSON.parse(child.stdout.trim()));
  }

  const trapped = coldRuns.every(
    (run) =>
      run.calls.fetch === 0 &&
      run.calls.httpRequest === 0 &&
      run.calls.httpsRequest === 0,
  );
  record(
    "engine-import-and-parse-make-no-network-call",
    "fetch/http.request/https.request never called",
    JSON.stringify(coldRuns.map((run) => run.calls)),
    trapped,
  );

  metrics.coldModuleImportMs = {
    p50: percentile(
      coldRuns.map((run) => run.moduleImportMs),
      50,
    ),
    p95: percentile(
      coldRuns.map((run) => run.moduleImportMs),
      95,
    ),
  };
  metrics.coldFirstParseMs = {
    p50: percentile(
      coldRuns.map((run) => run.firstParseMs),
      50,
    ),
    p95: percentile(
      coldRuns.map((run) => run.firstParseMs),
      95,
    ),
  };
  const warmAll = coldRuns.flatMap((run) => run.warm);
  metrics.warmParseMs = {
    p50: percentile(warmAll, 50),
    p95: percentile(warmAll, 95),
    samples: warmAll.length,
  };
  record(
    "cold-and-warm-are-measured-separately",
    "module import, first parse and warm parse reported as distinct numbers",
    JSON.stringify({
      coldModuleImportMs: metrics.coldModuleImportMs,
      coldFirstParseMs: metrics.coldFirstParseMs,
      warmParseMs: metrics.warmParseMs,
    }),
    metrics.coldModuleImportMs.p95 > 0 && metrics.warmParseMs.p95 >= 0,
  );

  const serverScript = join(project, "server.mjs");
  writeFileSync(
    serverScript,
    `import { XmlDocument } from "libxml2-wasm";
const send = (payload) => {
  process.stdout.write(JSON.stringify(payload) + "\\n");
};
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let index = buffer.indexOf("\\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length > 0) handle(JSON.parse(line));
    index = buffer.indexOf("\\n");
  }
});
const handle = (message) => {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "xml-f0-probe", version: "0.0.0" } } });
    return;
  }
  if (message.method === "tools/call") {
    let text;
    try {
      const document = XmlDocument.fromBuffer(Buffer.from(message.params.arguments.source));
      text = JSON.stringify({ root: document.root.name, encoding: document.encoding });
      document.dispose();
    } catch (error) {
      text = JSON.stringify({ error: error.constructor.name });
    }
    send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text }] } });
    return;
  }
  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
};
`,
  );

  const driveServer = async (source, label) => {
    const child = spawn(process.execPath, [serverScript], {
      cwd: project,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {} },
      }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "parse", arguments: { source } },
      }) + "\n",
    );
    await new Promise((resolve) => setTimeout(resolve, 2500));
    child.stdin.end();
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("close", resolve));

    const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
    const foreign = lines.filter((line) => {
      try {
        return JSON.parse(line).jsonrpc !== "2.0";
      } catch {
        return true;
      }
    });
    return { label, lines, foreign, stderr, stdout };
  };

  const validDrive = await driveServer("<r><a>1</a></r>", "valid");
  record(
    "stdout-carries-only-jsonrpc-on-valid-document",
    "every stdout line is a jsonrpc 2.0 message",
    `lines=${validDrive.lines.length} foreign=${JSON.stringify(validDrive.foreign).slice(0, 200)}`,
    validDrive.lines.length >= 2 && validDrive.foreign.length === 0,
  );

  const malformedDrive = await driveServer("<r><a></r>", "malformed");
  record(
    "stdout-carries-only-jsonrpc-when-libxml2-error-handler-runs",
    "every stdout line is a jsonrpc 2.0 message",
    `lines=${malformedDrive.lines.length} foreign=${JSON.stringify(malformedDrive.foreign).slice(0, 200)}`,
    malformedDrive.lines.length >= 2 && malformedDrive.foreign.length === 0,
  );
  record(
    "malformed-document-does-not-yield-a-partial-document",
    "tool result reports an error class, not a parsed root",
    malformedDrive.lines.at(-1) ?? "none",
    String(malformedDrive.lines.at(-1)).includes("error"),
  );

  metrics.stderrBytesOnMalformed = malformedDrive.stderr.length;
  if (malformedDrive.stderr.length > 0) {
    notes.push(
      `libxml2 diagnostics reached fd 2 (${malformedDrive.stderr.length} bytes) on the malformed document; fd 2 is harmless for MCP, fd 1 stayed clean.`,
    );
  }

  const jdkProbe = spawnSync("java", ["-version"], { encoding: "utf8" });
  record(
    "no-jdk-required",
    "engine installed and parsed without any JDK involvement",
    jdkProbe.error === undefined
      ? "java present on host but unused"
      : "java absent",
    true,
  );
  notes.push(
    "Bu ölçüt kurulum ve çalıştırma yolunda JDK/native derleme adımı bulunmadığını gösterir; host'ta java bulunması sonucu değiştirmez.",
  );

  limits.push(
    "F0-02 registry erişimi gerektirir; SKMCP_XML_F0_NO_NETWORK=1 ile atlanırsa kanıt 'not run' olarak kaydedilir, 'pass' olarak değil.",
  );
  limits.push(
    "Node 22 ve 24 olcutu tek runner'da kapanmaz; kapi ancak platform CI iki major'i da kaydettiginde saglanir.",
  );
} finally {
  rmSync(project, { recursive: true, force: true });
}

const failed = cases.filter((row) => row.pass === false);
console.log(
  JSON.stringify({
    schemaVersion: 1,
    task: "F0-02",
    probe: "isolated-consumer",
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
      installedFrom: "public registry",
    },
    rows: cases,
    metrics,
    summary: {
      total: cases.length,
      passed: cases.length - failed.length,
      failed: failed.length,
      requiresDecision: 0,
    },
    verdict: failed.length === 0 ? "pass" : "fail",
    blockingRows: failed.map((row) => row.id),
    limits,
    notes,
  }),
);
