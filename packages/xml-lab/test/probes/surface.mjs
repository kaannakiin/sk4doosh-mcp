import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";

const REVIEWED_REVISION = "394487987eece208b5d02274fedc6c292f84ee6b";
const PROVENANCE_COMMIT = "6e4dc82a323b6d27f2b3aca6dbec868949be83b7";
const UPSTREAM_PIN = {
  submoduleRepository: "https://github.com/jameslan/libxml2.git",
  submoduleCommit: "f52e859efe97cf3f0b78d731976402748878529a",
  version: "2.15.1",
};

const cases = [];
const notes = [];
const limits = [];

const record = (id, expected, actual, pass) => {
  cases.push({ id, expected, actual: String(actual), pass });
};

const require = createRequire(import.meta.url);
const enginePackagePath = require.resolve("libxml2-wasm/package.json");
const engineRoot = dirname(enginePackagePath);
const enginePackage = JSON.parse(readFileSync(enginePackagePath, "utf8"));

const readOptional = (relative) => {
  try {
    return readFileSync(join(engineRoot, relative), "utf8");
  } catch {
    return null;
  }
};

const lockfileIntegrity = (() => {
  try {
    const lockfile = readFileSync(
      new URL("../../../../pnpm-lock.yaml", import.meta.url),
      "utf8",
    );
    const match = lockfile.match(
      /libxml2-wasm@([\d.]+):\s*\n\s*resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}/,
    );
    return match === null ? null : { version: match[1], integrity: match[2] };
  } catch {
    return null;
  }
})();

const rawGlue = readOptional("lib/libxml2raw.mjs") ?? "";
const glueProbe = {
  fetch: rawGlue.includes("fetch("),
  readFileSync: rawGlue.includes("readFileSync"),
  instantiateStreaming: rawGlue.includes("instantiateStreaming"),
  locateFile: rawGlue.includes("locateFile"),
  wasmBinaryFile: rawGlue.includes("wasmBinaryFile"),
};

const engine = await import("libxml2-wasm");
const { XmlDocument, XmlXPath, ParseOption, diag } = engine;

const rootExports = Object.keys(engine).sort();
record(
  "root-exports-omit-fs-providers",
  "xmlRegisterFsInputProviders and fsInputProviders absent from package root",
  rootExports.filter((name) => name.toLowerCase().includes("fs")).join(",") ||
    "none",
  !rootExports.includes("xmlRegisterFsInputProviders") &&
    !rootExports.includes("fsInputProviders"),
);

record(
  "root-exports-diag",
  "diag namespace present",
  diag === undefined ? "absent" : Object.keys(diag).sort().join(","),
  diag !== undefined &&
    typeof diag.configure === "function" &&
    typeof diag.report === "function",
);

record(
  "root-exports-cleanup-input-provider",
  "xmlCleanupInputProvider present",
  typeof engine.xmlCleanupInputProvider,
  typeof engine.xmlCleanupInputProvider === "function",
);

const expectedParseOptions = {
  XML_PARSE_DEFAULT: 0,
  XML_PARSE_RECOVER: 1,
  XML_PARSE_NOENT: 2,
  XML_PARSE_DTDLOAD: 4,
  XML_PARSE_DTDATTR: 8,
  XML_PARSE_DTDVALID: 16,
  XML_PARSE_NOERROR: 32,
  XML_PARSE_NOWARNING: 64,
  XML_PARSE_NOBLANKS: 256,
  XML_PARSE_XINCLUDE: 1024,
  XML_PARSE_NONET: 2048,
  XML_PARSE_NSCLEAN: 8192,
  XML_PARSE_NOCDATA: 16384,
  XML_PARSE_HUGE: 524288,
  XML_PARSE_IGNORE_ENC: 2097152,
  XML_PARSE_NO_XXE: 8388608,
  XML_PARSE_UNZIP: 16777216,
  XML_PARSE_NO_SYS_CATALOG: 33554432,
  XML_PARSE_CATALOG_PI: 67108864,
};

for (const [name, expected] of Object.entries(expectedParseOptions)) {
  record(
    `parse-option-${name}`,
    String(expected),
    String(ParseOption[name]),
    ParseOption[name] === expected,
  );
}

const hardened =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

const forbidden = [
  "XML_PARSE_RECOVER",
  "XML_PARSE_NOENT",
  "XML_PARSE_DTDLOAD",
  "XML_PARSE_DTDATTR",
  "XML_PARSE_DTDVALID",
  "XML_PARSE_HUGE",
  "XML_PARSE_XINCLUDE",
  "XML_PARSE_UNZIP",
  "XML_PARSE_CATALOG_PI",
  "XML_PARSE_IGNORE_ENC",
  "XML_PARSE_NOCDATA",
  "XML_PARSE_NOBLANKS",
  "XML_PARSE_NSCLEAN",
  "XML_PARSE_NOERROR",
  "XML_PARSE_NOWARNING",
];

record(
  "hardened-word-excludes-forbidden-flags",
  "none of the forbidden flags set",
  forbidden.filter((name) => (hardened & ParseOption[name]) !== 0).join(",") ||
    "none",
  forbidden.every((name) => (hardened & ParseOption[name]) === 0),
);

const parsed = XmlDocument.fromString(
  '<r xmlns:a="urn:a"><a:t>1</a:t><t>2</t></r>',
);

record(
  "document-carries-warnings",
  "warnings array reachable on the instance",
  Array.isArray(parsed.warnings) ? "array" : typeof parsed.warnings,
  Array.isArray(parsed.warnings),
);

let timerFired = false;
const timer = setTimeout(() => {
  timerFired = true;
}, 0);
const busy = XmlDocument.fromBuffer(
  Buffer.from(`<r>${"<i>x</i>".repeat(120000)}</r>`),
);
record(
  "from-buffer-is-synchronous",
  "timer has not fired when fromBuffer returns",
  timerFired ? "timer fired" : "timer pending",
  timerFired === false,
);
busy.dispose();
clearTimeout(timer);

const scalarCases = [
  ["empty-nodeset", "/r/nope", (v) => Array.isArray(v) && v.length === 0, "[]"],
  ["empty-string", "string(/r/nope)", (v) => Object.is(v, ""), '""'],
  ["zero", "count(/r/nope)", (v) => Object.is(v, 0), "0"],
  ["negative-zero", "-1 * 0", (v) => Object.is(v, -0), "-0"],
  ["nan", "number(/r/nope)", (v) => Number.isNaN(v), "NaN"],
  ["positive-infinity", "1 div 0", (v) => v === Infinity, "Infinity"],
  ["negative-infinity", "-1 div 0", (v) => v === -Infinity, "-Infinity"],
  ["false", "false()", (v) => v === false, "false"],
  ["true", "true()", (v) => v === true, "true"],
];

for (const [id, expression, predicate, expected] of scalarCases) {
  const value = parsed.eval(expression);
  record(
    `xpath-scalar-${id}`,
    expected,
    Array.isArray(value) ? `array(${value.length})` : String(value),
    predicate(value),
  );
}

const namespaced = parsed.eval("//x:t", { x: "urn:a" });
record(
  "namespace-uri-selects-only-matching",
  "1 node, uri urn:a, text 1",
  namespaced
    .map((node) => `${node.namespaceUri}|${node.name}|${node.content}`)
    .join(","),
  namespaced.length === 1 &&
    namespaced[0].namespaceUri === "urn:a" &&
    namespaced[0].name === "t" &&
    namespaced[0].content === "1",
);

const unprefixed = parsed.eval("//t");
record(
  "unprefixed-does-not-bind-default-namespace",
  "1 node, empty uri, text 2",
  unprefixed
    .map((node) => `${node.namespaceUri}|${node.name}|${node.content}`)
    .join(","),
  unprefixed.length === 1 &&
    unprefixed[0].namespaceUri === "" &&
    unprefixed[0].content === "2",
);

let getThrewOnScalar = false;
try {
  parsed.get("false()");
} catch {
  getThrewOnScalar = true;
}
record(
  "get-throws-on-scalar",
  "throws",
  getThrewOnScalar ? "throws" : "returned",
  getThrewOnScalar,
);
record(
  "get-returns-null-on-empty-nodeset",
  "null (conflation hazard confirmed; eval is the only safe entry point)",
  String(parsed.get("/r/nope")),
  parsed.get("/r/nope") === null,
);

parsed.dispose();

const encodingCases = [
  ['<?xml version="1.0" encoding="UTF-8"?><r/>', "UTF-8"],
  ['<?xml version="1.0"?><r/>', null],
  ["<r/>", null],
];
for (const [source, expected] of encodingCases) {
  const document = XmlDocument.fromBuffer(Buffer.from(source));
  record(
    `declared-encoding-${expected ?? "absent"}`,
    String(expected),
    String(document.encoding),
    document.encoding === expected,
  );
  document.dispose();
}

diag.configure({ enabled: true });
const tracked = XmlDocument.fromString("<r/>");
const afterAllocate = diag.report();
tracked.dispose();
const afterDispose = diag.report();
record(
  "diag-tracks-live-instance",
  "XmlDocument totalInstances 1",
  JSON.stringify(afterAllocate.XmlDocument?.totalInstances ?? null),
  afterAllocate.XmlDocument?.totalInstances === 1,
);
record(
  "diag-clears-entry-on-dispose",
  "empty report",
  JSON.stringify(Object.keys(afterDispose)),
  Object.keys(afterDispose).length === 0,
);
record(
  "diag-reports-garbage-collected-counter",
  "garbageCollected 0 after explicit dispose",
  JSON.stringify(afterAllocate.XmlDocument?.garbageCollected ?? null),
  afterAllocate.XmlDocument?.garbageCollected === 0,
);

const compiled = XmlXPath === undefined ? null : XmlXPath;
record(
  "compiled-xpath-surface-present",
  "XmlXPath exported with compile-like surface",
  compiled === null ? "absent" : Object.getOwnPropertyNames(compiled).join(","),
  compiled !== null,
);

record(
  "wasm-glue-has-no-network-or-fs-loader",
  "no fetch / readFileSync / instantiateStreaming / locateFile / wasmBinaryFile",
  JSON.stringify(glueProbe),
  Object.values(glueProbe).every((present) => present === false),
);

const wrapperLicense = readOptional("LICENSE");
const embeddedLicense = readOptional("LICENSE.libxml2");
record(
  "embedded-license-is-a-separate-file",
  "LICENSE.libxml2 present and distinct from LICENSE",
  embeddedLicense === null ? "absent" : "present",
  embeddedLicense !== null && wrapperLicense !== null,
);

const embeddedVersion = (() => {
  const runtime = engine.LIBXML_DOTTED_VERSION ?? engine.xmlParserVersion;
  if (typeof runtime === "string") {
    return { value: runtime, source: "runtime-export" };
  }
  const scan = rawGlue.match(/\b(2\.\d{1,2}\.\d{1,3})\b/g);
  if (scan !== null && scan.length > 0) {
    const counts = new Map();
    for (const hit of scan) counts.set(hit, (counts.get(hit) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { value: best[0], source: "wasm-data-scan" };
  }
  return { value: UPSTREAM_PIN.version, source: "upstream-pin" };
})();

record(
  "embedded-libxml2-version-determined",
  "a version string from runtime-export, wasm-data-scan or upstream-pin",
  `${embeddedVersion.value ?? "undetermined"} (${embeddedVersion.source})`,
  embeddedVersion.value !== null,
);

if (embeddedVersion.source === "upstream-pin") {
  limits.push(
    "Gomulu libxml2 surumu yalniz upstream-pin ile belirlendi: runtime export yok ve WASM string tablosu --without-debug nedeniyle surum tasimiyor. Bu basamak kaynagi tarif eder, dagitilan artifact'i degil.",
  );
  limits.push(
    `Gomulu kaynak upstream GNOME/libxml2 degil ${UPSTREAM_PIN.submoduleRepository} fork'udur (${UPSTREAM_PIN.submoduleCommit}); fork ustunde yerel yama vardir. CVE takibi 2.15.1 uzerinden yapilir, fork farki ayrica izlenir.`,
  );
  limits.push(
    "libxml2 2.15 nanohttp'yi kaldirdi; XML_PARSE_NONET bu derlemede no-op olabilir. Ag canary'sinin sifir hit'i asiri-belirlenmistir ve ek guvence sayilmaz (F0-05).",
  );
}

const beforeRss = process.memoryUsage.rss();
const ballast = Buffer.alloc(256 * 1024 * 1024, 0x61);
const afterRss = process.memoryUsage.rss();
const maxRss = process.resourceUsage().maxRSS;
const grewBytes = afterRss - beforeRss;
const maxRssUnit =
  maxRss > 0 && maxRss < afterRss / 512
    ? "KiB"
    : maxRss >= afterRss / 2
      ? "bytes"
      : "unknown";
record(
  "max-rss-unit-resolved",
  "KiB or bytes",
  `${maxRssUnit} (maxRSS=${maxRss}, rss=${afterRss}, grew=${grewBytes})`,
  maxRssUnit !== "unknown",
);
assert.ok(ballast.length === 256 * 1024 * 1024);

notes.push(
  `reviewed revision ${REVIEWED_REVISION} is 0.8.0-dev on master; the published artifact is built from a different commit recorded in the npm provenance attestation.`,
);
limits.push(
  "Bu probe agsizdir; provenance attestation ve advisory kapsami F0-01 karar ekinde ayrica kaydedilir.",
);

const failed = cases.filter((row) => row.pass === false);
const envelope = {
  schemaVersion: 1,
  task: "F0-01",
  probe: "surface",
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
    maxRssUnit,
  },
  engine: {
    name: "libxml2-wasm",
    specifier: "0.7.2",
    version: enginePackage.version,
    lockfileIntegrity: lockfileIntegrity?.integrity ?? null,
    wrapperLicense: enginePackage.license ?? null,
    embeddedLicenseFile: embeddedLicense === null ? null : "LICENSE.libxml2",
    embeddedLibxml2Version: embeddedVersion.value,
    embeddedLibxml2VersionSource: embeddedVersion.source,
    provenanceCommit: PROVENANCE_COMMIT,
    reviewedRevision: REVIEWED_REVISION,
    artifactMatchesReviewedRevision: false,
  },
  rows: cases,
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
};

console.log(JSON.stringify(envelope));
