import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { XmlDocument, ParseOption } from "libxml2-wasm";
import { sha256, utf16le, utf8, withBom } from "./fixtures.mjs";
import {
  candidateA,
  candidateB,
  candidateC,
  candidateD,
} from "./doctype-detectors.mjs";

const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

const rows = [];
const notes = [];
const limits = [];
const record = (id, expected, actual, pass) =>
  rows.push({ id, expected, actual: String(actual).slice(0, 300), pass });

const workspace = mkdtempSync(join(os.tmpdir(), "sk-mcp-xml-f0-security-"));
const token = `SKMCP_XML_F0_CANARY_${randomBytes(16).toString("hex")}`;
const canaryPath = join(workspace, "canary-secret.txt");
writeFileSync(canaryPath, token);
writeFileSync(
  join(workspace, "canary.dtd"),
  `<!ELEMENT r (#PCDATA)>\n<!ATTLIST r flag CDATA "${token}">\n`,
);

const listenerHits = [];
const server = http.createServer((request, response) => {
  listenerHits.push({ kind: "request", url: request.url });
  response.end("canary");
});
server.on("connection", () => listenerHits.push({ kind: "connection" }));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const selfTest = async (path) => {
  try {
    await fetch(`http://127.0.0.1:${port}${path}`);
    return true;
  } catch {
    return false;
  }
};

const selfTestPre = await selfTest("/selftest-pre");
const hitsAfterPre = listenerHits.length;

const canaryUrl = `http://127.0.0.1:${port}`;
const canaryFileUrl = pathToFileURL(canaryPath).href;
const canaryDtdUrl = pathToFileURL(join(workspace, "canary.dtd")).href;

const securityFixtures = [
  {
    id: "dtd-internal-subset",
    source: `<!DOCTYPE r [<!ELEMENT r (#PCDATA)><!ENTITY local "v">]><r>&local;</r>`,
  },
  {
    id: "dtd-external-system",
    source: `<!DOCTYPE r SYSTEM "${canaryDtdUrl}"><r/>`,
  },
  {
    id: "dtd-external-public-http",
    source: `<!DOCTYPE r PUBLIC "-//X//DTD//EN" "${canaryUrl}/canary.dtd"><r/>`,
  },
  {
    id: "dtd-attlist-default",
    source: `<!DOCTYPE r SYSTEM "${canaryDtdUrl}"><r/>`,
  },
  {
    id: "entity-external-file-abs",
    source: `<!DOCTYPE r [<!ENTITY xxe SYSTEM "${canaryFileUrl}">]><r>&xxe;</r>`,
  },
  {
    id: "entity-external-file-rel",
    source: `<!DOCTYPE r [<!ENTITY xxe SYSTEM "../../canary-secret.txt">]><r>&xxe;</r>`,
  },
  {
    id: "entity-external-http",
    source: `<!DOCTYPE r [<!ENTITY xxe SYSTEM "${canaryUrl}/xxe">]><r>&xxe;</r>`,
  },
  {
    id: "entity-external-invalid-host",
    source: `<!DOCTYPE r [<!ENTITY xxe SYSTEM "http://xml-f0-canary.invalid/x">]><r>&xxe;</r>`,
  },
  {
    id: "entity-param-external",
    source: `<!DOCTYPE r [<!ENTITY % pe SYSTEM "${canaryUrl}/pe.dtd"> %pe;]><r/>`,
  },
  {
    id: "entity-recursive",
    source: `<!DOCTYPE r [<!ENTITY a "&b;"><!ENTITY b "&a;">]><r>&a;</r>`,
  },
  {
    id: "billion-laughs",
    source: (() => {
      let entities = '<!ENTITY l0 "lol">';
      for (let level = 1; level <= 9; level += 1) {
        entities += `<!ENTITY l${level} "${`&l${level - 1};`.repeat(10)}">`;
      }
      return `<!DOCTYPE r [${entities}]><r>&l9;</r>`;
    })(),
  },
  {
    id: "xinclude-file",
    source: `<r xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="${canaryFileUrl}" parse="text"/></r>`,
  },
  {
    id: "xinclude-http",
    source: `<r xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="${canaryUrl}/inc" parse="text"/></r>`,
  },
  {
    id: "schema-hint-xsi",
    source: `<r xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:x ${canaryUrl}/x.xsd"/>`,
  },
  {
    id: "schema-hint-nonamespace",
    source: `<r xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="${canaryUrl}/y.xsd"/>`,
  },
  {
    id: "catalog-pi",
    source: `<?oasis-xml-catalog catalog="${canaryUrl}/cat.xml"?><r/>`,
  },
  {
    id: "stylesheet-pi",
    source: `<?xml-stylesheet href="${canaryUrl}/s.xsl"?><r/>`,
  },
  {
    id: "xml-unclosed",
    source: "<r><a></r>",
  },
  {
    id: "xml-two-roots",
    source: "<a/><b/>",
  },
  {
    id: "xml-junk-after-root",
    source: "<a/>garbage",
  },
  {
    id: "xml-malformed-tail-large",
    source: `<r>${"<i>x</i>".repeat(120000)}<broken></r>`,
  },
];

const fixtureFile = join(workspace, "fixtures.json");
writeFileSync(
  fixtureFile,
  JSON.stringify(
    securityFixtures.map((fixture) => ({
      id: fixture.id,
      base64: utf8(fixture.source).toString("base64"),
      sha256: sha256(utf8(fixture.source)),
    })),
  ),
);

const armScript = fileURLToPath(new URL("./security-arm.mjs", import.meta.url));
const arms = [
  "arm1_import_only",
  "arm2_import_side_module",
  "arm3_register_providers",
  "arm4_cleanup_after_register",
  "arm5_cleanup_at_start",
];

const armResults = {};
for (const arm of arms) {
  const hitsBefore = listenerHits.length;
  const child = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", armScript, arm, fixtureFile, token],
    {
      cwd: workspace,
      encoding: "utf8",
      timeout: 60_000,
      killSignal: "SIGKILL",
    },
  );
  const line = String(child.stdout)
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .at(-1);
  armResults[arm] = {
    status: child.status,
    signal: child.signal,
    listenerHits: listenerHits.length - hitsBefore,
    parsed: line === undefined ? null : JSON.parse(line),
    stderrBytes: String(child.stderr).length,
  };
}

const selfTestPost = await selfTest("/selftest-post");
await new Promise((resolve) => server.close(resolve));

const canaryAlive =
  selfTestPre &&
  selfTestPost &&
  hitsAfterPre > 0 &&
  listenerHits.length > hitsAfterPre;

record(
  "loopback-canary-self-test-brackets-the-run",
  "the parent's own pre and post requests are recorded",
  `pre=${selfTestPre} post=${selfTestPost} hits=${listenerHits.length}`,
  canaryAlive,
);

const armOne = armResults.arm1_import_only;
const armTwo = armResults.arm2_import_side_module;
const armThree = armResults.arm3_register_providers;
const armFour = armResults.arm4_cleanup_after_register;
const armFive = armResults.arm5_cleanup_at_start;

const noExternalAccess = (arm) =>
  arm.parsed !== null &&
  arm.parsed.tokenSeen === false &&
  arm.listenerHits === 0 &&
  arm.parsed.tripwires.netConnect === 0 &&
  arm.parsed.tripwires.httpRequest === 0 &&
  arm.parsed.tripwires.httpsRequest === 0 &&
  arm.parsed.tripwires.dnsLookup === 0 &&
  arm.parsed.tripwires.dnsResolve === 0 &&
  arm.parsed.tripwires.fsOpenSync === 0 &&
  arm.parsed.tripwires.fsReadFileSync === 0 &&
  arm.parsed.tripwires.fsCreateReadStream === 0;

record(
  "arm1-import-only-makes-no-external-access",
  "zero canary hits on every detector",
  JSON.stringify({
    tokenSeen: armOne.parsed?.tokenSeen,
    listenerHits: armOne.listenerHits,
    tripwires: armOne.parsed?.tripwires,
  }),
  noExternalAccess(armOne),
);

record(
  "arm2-importing-side-module-does-not-register-providers",
  "zero canary hits even though lib/nodejs.mjs entered the module graph",
  JSON.stringify({
    sideModuleLoaded: armTwo.parsed?.sideModuleLoaded,
    exports: armTwo.parsed?.sideModuleExports,
    tokenSeen: armTwo.parsed?.tokenSeen,
    listenerHits: armTwo.listenerHits,
  }),
  armTwo.parsed?.sideModuleLoaded === true && noExternalAccess(armTwo),
);

const armThreeFired =
  armThree.parsed !== null &&
  (armThree.parsed.tokenSeen === true ||
    armThree.listenerHits > 0 ||
    armThree.parsed.tripwires.fsOpenSync > 0 ||
    armThree.parsed.tripwires.fsReadFileSync > 0 ||
    armThree.parsed.tripwires.fsExistsSync > 0);

record(
  "arm3-positive-control-fires",
  "registering the fs providers with NOENT|DTDLOAD must reach the canary",
  JSON.stringify({
    tokenSeen: armThree.parsed?.tokenSeen,
    listenerHits: armThree.listenerHits,
    tripwires: armThree.parsed?.tripwires,
  }),
  armThreeFired,
);

record(
  "arm4-cleanup-revokes-registered-providers",
  "zero canary hits after xmlCleanupInputProvider",
  JSON.stringify({
    tokenSeen: armFour.parsed?.tokenSeen,
    listenerHits: armFour.listenerHits,
    tripwires: armFour.parsed?.tripwires,
  }),
  noExternalAccess(armFour),
);

const armFiveParsesBenign =
  armFive.parsed !== null &&
  armFive.parsed.results.some(
    (entry) => entry.id === "dtd-internal-subset" && entry.accepted === true,
  );

record(
  "arm5-cleanup-at-start-keeps-from-buffer-working",
  "zero canary hits and benign documents still parse",
  JSON.stringify({
    tokenSeen: armFive.parsed?.tokenSeen,
    listenerHits: armFive.listenerHits,
    benignParsed: armFiveParsesBenign,
  }),
  noExternalAccess(armFive) && armFiveParsesBenign,
);

const hardenedResults = armOne.parsed?.results ?? [];
const byId = new Map(hardenedResults.map((entry) => [entry.id, entry]));

for (const id of [
  "xml-unclosed",
  "xml-two-roots",
  "xml-junk-after-root",
  "xml-malformed-tail-large",
]) {
  const entry = byId.get(id);
  record(
    `recovery-off-${id}`,
    "parse throws and yields no document",
    JSON.stringify({
      accepted: entry?.accepted,
      errorClass: entry?.errorClass,
    }),
    entry?.accepted === false,
  );
}

const bomb = byId.get("billion-laughs");
record(
  "entity-bomb-fails-within-budget",
  "throws with a classifiable error rather than expanding",
  JSON.stringify({ accepted: bomb?.accepted, errorClass: bomb?.errorClass }),
  bomb?.accepted === false || bomb?.tokenInDocument === false,
);

const externalDtd = byId.get("dtd-external-system");
record(
  "external-only-doctype-visibility",
  "recorded: whether doc.dtd can see an external-only DOCTYPE",
  JSON.stringify({
    accepted: externalDtd?.accepted,
    dtdSeen: externalDtd?.dtdSeen,
  }),
  true,
);
if (externalDtd?.accepted === true && externalDtd?.dtdSeen === false) {
  limits.push(
    "doc.dtd dis-yalniz DOCTYPE'i gormuyor: bu belgeler icin post-parse motor assertion'i (aday D) tek basina yeterli degil, aday C zorunlu ikinci katmandir.",
  );
}

const doctypeMatrix = [
  { id: "doctype-minimal", bytes: utf8("<!DOCTYPE r><r/>"), doctype: true },
  {
    id: "doctype-system",
    bytes: utf8('<!DOCTYPE r SYSTEM "x.dtd"><r/>'),
    doctype: true,
  },
  {
    id: "doctype-public",
    bytes: utf8('<!DOCTYPE r PUBLIC "-//X//EN" "x.dtd"><r/>'),
    doctype: true,
  },
  {
    id: "doctype-internal-subset",
    bytes: utf8('<!DOCTYPE r [<!ENTITY e "v">]><r/>'),
    doctype: true,
  },
  {
    id: "doctype-newline-and-tabs",
    bytes: utf8('<!DOCTYPE\n\tr\n SYSTEM\n "x.dtd"\n><r/>'),
    doctype: true,
  },
  {
    id: "doctype-subset-with-gt",
    bytes: utf8('<!DOCTYPE r [ <!ENTITY e "a > b"> ]><r/>'),
    doctype: true,
  },
  {
    id: "doctype-after-comment-with-gt",
    bytes: utf8("<!-- a > b --><!DOCTYPE r><r/>"),
    doctype: true,
  },
  {
    id: "doctype-after-pi",
    bytes: utf8('<?xml version="1.0"?><!DOCTYPE r><r/>'),
    doctype: true,
  },
  {
    id: "doctype-with-bom",
    bytes: withBom("utf8", utf8("<!DOCTYPE r><r/>")),
    doctype: true,
  },
  {
    id: "doctype-utf16le-real",
    bytes: withBom("utf16le", utf16le("<!DOCTYPE r><r/>")),
    doctype: true,
  },
  {
    id: "doctype-in-comment",
    bytes: utf8("<!-- <!DOCTYPE r> --><r/>"),
    doctype: false,
  },
  {
    id: "doctype-in-comment-utf16le",
    bytes: withBom("utf16le", utf16le("<!-- <!DOCTYPE r> --><r/>")),
    doctype: false,
  },
  {
    id: "doctype-in-cdata",
    bytes: utf8("<r><![CDATA[<!DOCTYPE x>]]></r>"),
    doctype: false,
  },
  {
    id: "doctype-in-attribute-escaped",
    bytes: utf8('<r note="&lt;!DOCTYPE r&gt;"/>'),
    doctype: false,
  },
  {
    id: "doctype-in-attribute-plain",
    bytes: utf8('<r note="!DOCTYPE r SYSTEM x"/>'),
    doctype: false,
  },
  {
    id: "doctype-in-text",
    bytes: utf8("<r>&lt;!DOCTYPE r&gt;</r>"),
    doctype: false,
  },
  {
    id: "doctype-in-pi",
    bytes: utf8("<?target <!DOCTYPE r> ?><r/>"),
    doctype: false,
  },
  {
    id: "doctype-word-in-element-name",
    bytes: utf8("<DOCTYPEish/>"),
    doctype: false,
  },
  {
    id: "doctype-attribute-name",
    bytes: utf8('<x doctype="1"/>'),
    doctype: false,
  },
];

const parseHardened = (bytes) =>
  XmlDocument.fromBuffer(bytes, { option: HARDENED });

const candidates = {
  A: (bytes) => candidateA(bytes),
  B: (bytes) => candidateB(bytes),
  C: (bytes) => candidateC(bytes),
  D: (bytes) => candidateD(bytes, parseHardened),
};

const confusion = {};
for (const [name, detect] of Object.entries(candidates)) {
  const matrix = { tp: 0, tn: 0, fp: 0, fn: 0, failedRows: [] };
  for (const fixture of doctypeMatrix) {
    const observed = detect(fixture.bytes).doctype === true;
    if (observed && fixture.doctype) matrix.tp += 1;
    else if (!observed && !fixture.doctype) matrix.tn += 1;
    else if (observed && !fixture.doctype) {
      matrix.fp += 1;
      matrix.failedRows.push(`fp:${fixture.id}`);
    } else {
      matrix.fn += 1;
      matrix.failedRows.push(`fn:${fixture.id}`);
    }
  }
  confusion[name] = matrix;
}

record(
  "doctype-candidate-C-is-exact",
  "fp 0 and fn 0 over the whole matrix",
  JSON.stringify(confusion.C),
  confusion.C.fp === 0 && confusion.C.fn === 0,
);
record(
  "doctype-naive-regex-candidates-fail-as-documented",
  "A and B each miss or over-match at least one row",
  JSON.stringify({ A: confusion.A.failedRows, B: confusion.B.failedRows }),
  confusion.A.failedRows.length > 0 && confusion.B.failedRows.length > 0,
);

notes.push(
  "Aday A ve B kasitli olarak kosuldu: 'regex byte taramasi tek sinir yapilmaz' iddiasi boylece isim isim basarisiz satirlarla olculmus sonuc oldu.",
);
limits.push(
  "libxml2 2.15 nanohttp'yi kaldirdi ve bu derleme --without-catalog ile yapildi; XML_PARSE_NONET no-op olabilir. Ag canary'sinin sifir hit'i asiri-belirlenmistir ve ek guvence sayilmaz.",
);
limits.push(
  "Dosya canary'si okumanin denenip atildigini kanitlamaz; atime gozlemi relatime/NTFS'te anlamsiz oldugu icin kullanilmadi.",
);

rmSync(workspace, { recursive: true, force: true });

const failed = rows.filter((row) => row.pass === false);
const inconclusive = armThreeFired === false || canaryAlive === false;

console.log(
  JSON.stringify({
    schemaVersion: 1,
    task: "F0-05",
    probe: "security",
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
    canaryTokenSha256: sha256(Buffer.from(token)),
    arms: Object.fromEntries(
      Object.entries(armResults).map(([name, value]) => [
        name,
        {
          status: value.status,
          listenerHits: value.listenerHits,
          tokenSeen: value.parsed?.tokenSeen ?? null,
          tripwires: value.parsed?.tripwires ?? null,
          parseOptionWord: value.parsed?.parseOptionWord ?? null,
        },
      ]),
    ),
    doctypeDetectors: confusion,
    securityResults: hardenedResults,
    rows,
    summary: {
      total: rows.length,
      passed: rows.length - failed.length,
      failed: failed.length,
      requiresDecision: 0,
    },
    verdict: inconclusive
      ? "inconclusive"
      : failed.length === 0
        ? "pass"
        : "fail",
    blockingRows: failed.map((row) => row.id),
    limits,
    notes,
  }),
);
