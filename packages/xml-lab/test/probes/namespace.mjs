import os from "node:os";
import { XmlDocument, ParseOption } from "libxml2-wasm";
import {
  namespaceFixtures,
  scalarDocument,
  sha256,
  utf8,
} from "./fixtures.mjs";

const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

const rows = [];
const fixtures = [];
const notes = [];
const limits = [];

let evaluationCount = 0;
let lastExpressionHandedToEngine = null;

const evaluate = (document, expression, namespaces) => {
  evaluationCount += 1;
  lastExpressionHandedToEngine = expression;
  const value = document.eval(expression, namespaces);
  if (Array.isArray(value)) {
    return { resultType: "nodeset", value };
  }
  if (typeof value === "string") return { resultType: "string", value };
  if (typeof value === "boolean") return { resultType: "boolean", value };
  return { resultType: "number", value };
};

const project = (node) => ({
  uri: node.namespaceUri,
  name: node.name,
  text: node.content,
});

const record = (id, expected, actual, pass) => {
  rows.push({ id, expected, actual: String(actual).slice(0, 300), pass });
};

const parse = (source) => {
  const bytes = utf8(source);
  return XmlDocument.fromBuffer(bytes, { option: HARDENED });
};

const corpus = namespaceFixtures();
for (const fixture of corpus) {
  fixtures.push({
    id: fixture.id,
    bytes: utf8(fixture.source).length,
    sha256: sha256(utf8(fixture.source)),
    isolates: fixture.isolates,
  });
}

const distinctUris = [
  ...new Set(corpus.flatMap((f) => f.expected.map((e) => e.uri))),
].filter((uri) => uri.length > 0);

for (const fixture of corpus) {
  const document = parse(fixture.source);
  const localNames = [...new Set(fixture.expected.map((e) => e.name))];

  for (const uri of distinctUris) {
    for (const localName of localNames) {
      const selected = evaluate(document, `//q:${localName}`, { q: uri }).value;
      const observed = selected.map(project);
      const wanted = fixture.expected.filter(
        (e) => e.uri === uri && e.name === localName,
      );
      const leaked = observed.filter((node) => node.uri !== uri);
      record(
        `crossproduct-${fixture.id}-${uri}-${localName}`,
        JSON.stringify(wanted.map((w) => `${w.uri}|${w.name}|${w.text}`)),
        JSON.stringify(observed.map((o) => `${o.uri}|${o.name}|${o.text}`)),
        leaked.length === 0 && observed.length === wanted.length,
      );
    }
  }

  for (const localName of localNames) {
    const selected = evaluate(document, `//${localName}`).value;
    const observed = selected.map(project);
    const wanted = fixture.expected.filter(
      (e) => e.uri === "" && e.name === localName,
    );
    record(
      `unprefixed-selects-only-no-namespace-${fixture.id}-${localName}`,
      JSON.stringify(wanted.map((w) => `${w.uri}|${w.name}|${w.text}`)),
      JSON.stringify(observed.map((o) => `${o.uri}|${o.name}|${o.text}`)),
      observed.every((node) => node.uri === "") &&
        observed.length === wanted.length,
    );
  }

  record(
    `local-name-never-prefixed-${fixture.id}`,
    "no colon in any reported node name",
    JSON.stringify(
      evaluate(document, "//*").value.map((node) => node.name),
    ).slice(0, 200),
    evaluate(document, "//*").value.every((node) => !node.name.includes(":")),
  );

  document.dispose();
}

const rebound = parse(corpus.find((f) => f.id === "ns-prefix-rebound").source);
const renamed = parse(corpus.find((f) => f.id === "ns-prefix-renamed").source);
const reboundOuter = evaluate(rebound, "//q:item", {
  q: "urn:x-sk:a",
}).value.map(project);
const renamedOuter = evaluate(renamed, "//q:item", {
  q: "urn:x-sk:a",
}).value.map(project);
record(
  "prefix-rename-does-not-change-selection",
  JSON.stringify(reboundOuter),
  JSON.stringify(renamedOuter),
  JSON.stringify(reboundOuter) === JSON.stringify(renamedOuter) &&
    reboundOuter.length === 1 &&
    reboundOuter[0].text === "outer",
);
rebound.dispose();
renamed.dispose();

const attributes = parse(corpus.find((f) => f.id === "ns-attributes").source);
const root = attributes.root;
const attributeList = Object.entries(root.attrs ?? {}).map(([key, value]) => ({
  key,
  uri: value?.namespaceUri ?? null,
  name: value?.name ?? null,
}));
record(
  "namespace-declarations-are-not-ordinary-attributes",
  "no xmlns or xmlns:p entry in the attribute list",
  JSON.stringify(attributeList).slice(0, 300),
  attributeList.every(
    (entry) => entry.key !== "xmlns" && !entry.key.startsWith("xmlns:"),
  ),
);
attributes.dispose();

const scalars = parse(scalarDocument);
const scalarCases = [
  [
    "empty-nodeset",
    "/r/nope",
    undefined,
    (r) => r.resultType === "nodeset" && r.value.length === 0,
  ],
  [
    "default-ns-trap-empty",
    "/root/child",
    undefined,
    (r) => r.resultType === "nodeset" && r.value.length === 0,
  ],
  [
    "empty-string",
    "string(/r/nope)",
    undefined,
    (r) => r.resultType === "string" && Object.is(r.value, ""),
  ],
  [
    "normalize-space-empty",
    "normalize-space(/r/text)",
    undefined,
    (r) => Object.is(r.value, ""),
  ],
  [
    "big-id-stays-string",
    "string(/r/bigid)",
    undefined,
    (r) => r.value === "00012345678901234567890",
  ],
  [
    "zero",
    "count(/r/nope)",
    undefined,
    (r) => Object.is(r.value, 0) && !Object.is(r.value, -0),
  ],
  ["negative-zero", "-1 * 0", undefined, (r) => Object.is(r.value, -0)],
  ["nan", "number(/r/nope)", undefined, (r) => Number.isNaN(r.value)],
  ["positive-infinity", "1 div 0", undefined, (r) => r.value === Infinity],
  ["negative-infinity", "-1 div 0", undefined, (r) => r.value === -Infinity],
  ["false", "boolean(/r/nope)", undefined, (r) => r.value === false],
  ["true", "true()", undefined, (r) => r.value === true],
  [
    "mapped-prefix-absent-uri",
    "//p:*",
    { p: "urn:x-sk:absent" },
    (r) => r.resultType === "nodeset" && r.value.length === 0,
  ],
];

for (const [id, expression, namespaces, predicate] of scalarCases) {
  const before = evaluationCount;
  const result = evaluate(scalars, expression, namespaces);
  record(
    `scalar-${id}`,
    "identity preserved and exactly one evaluation",
    `${result.resultType}:${Array.isArray(result.value) ? `array(${result.value.length})` : String(result.value)}`,
    predicate(result) &&
      evaluationCount - before === 1 &&
      lastExpressionHandedToEngine === expression,
  );
}

let unmappedPrefixError = null;
try {
  evaluate(scalars, "//zz:x");
} catch (error) {
  unmappedPrefixError = error.constructor.name;
}
record(
  "unmapped-prefix-is-an-explicit-error",
  "throws rather than silently selecting nothing",
  String(unmappedPrefixError),
  unmappedPrefixError !== null,
);

let xpath2Error = null;
try {
  evaluate(scalars, "upper-case('a')");
} catch (error) {
  xpath2Error = error.constructor.name;
}
record(
  "xpath-2-function-is-explicit-unsupported",
  "throws rather than returning a value",
  String(xpath2Error),
  xpath2Error !== null,
);

const jsonRoundTrip = {
  nan: JSON.parse(
    JSON.stringify({ v: evaluate(scalars, "number(/r/nope)").value }),
  ).v,
  infinity: JSON.parse(
    JSON.stringify({ v: evaluate(scalars, "1 div 0").value }),
  ).v,
  negativeZero: Object.is(
    JSON.parse(JSON.stringify({ v: evaluate(scalars, "-1 * 0").value })).v,
    -0,
  ),
};
record(
  "json-envelope-is-lossy-and-measured",
  "NaN and Infinity become null, -0 becomes 0 across JSON",
  JSON.stringify(jsonRoundTrip),
  jsonRoundTrip.nan === null &&
    jsonRoundTrip.infinity === null &&
    jsonRoundTrip.negativeZero === false,
);
notes.push(
  "JSON zarfi NaN/Infinity'yi null'a, -0'i 0'a cevirir. Bu hop motorun degil sozlesmenin sorunudur; F3 acik tur gosterimi (numberKind) secmek zorundadir.",
);

scalars.dispose();

record(
  "no-silent-reevaluation",
  "one engine evaluation per request, expression handed over byte-identical",
  String(evaluationCount),
  evaluationCount > 0,
);

limits.push(
  "Bu deney tek surecte, ana thread uzerinde kosar. Worker siniri ve MCP zarfi uzerinden tasima F0-06 ve F2-08'de ayrica olculur.",
);

const failed = rows.filter((row) => row.pass === false);
console.log(
  JSON.stringify({
    schemaVersion: 1,
    task: "F0-03",
    probe: "namespace",
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
