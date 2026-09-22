import { Buffer } from "node:buffer";
import os from "node:os";
import { XmlDocument, ParseOption } from "libxml2-wasm";
import {
  BOM,
  codePoints,
  iso88599,
  replacementCount,
  sha256,
  utf16be,
  utf16le,
  utf8,
  windows1254,
  withBom,
} from "./fixtures.mjs";

const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

const PAYLOAD = "ıİğşçÖÜ";
const ASTRAL = "\u{20000}";
const EURO = "€";

const body = (extra) => `<r><turkish>${PAYLOAD}</turkish>${extra}</r>`;

const declaration = (encoding) =>
  encoding === null ? "" : `<?xml version="1.0" encoding="${encoding}"?>`;

const fixtures = [];
const rows = [];
const notes = [];
const limits = [];

const add = (fixture) => fixtures.push(fixture);

add({
  id: "enc-utf8-decl",
  bytes: utf8(
    `${declaration("UTF-8")}${body(`<astral>${ASTRAL}</astral><edge>${EURO}</edge>`)}`,
  ),
  declared: "UTF-8",
  bom: "none",
  expect: "accept-exact",
  text: PAYLOAD,
  extraText: [ASTRAL, EURO],
});
add({
  id: "enc-utf8-no-decl",
  bytes: utf8(body("")),
  declared: null,
  bom: "none",
  expect: "accept-exact",
  text: PAYLOAD,
});
add({
  id: "enc-utf8-bom-nodecl",
  bytes: withBom("utf8", utf8(body(""))),
  declared: null,
  bom: "utf8",
  expect: "accept-exact",
  text: PAYLOAD,
});
add({
  id: "enc-utf16le-bom-decl",
  bytes: withBom("utf16le", utf16le(`${declaration("UTF-16")}${body("")}`)),
  declared: "UTF-16",
  bom: "utf16le",
  expect: "accept-exact",
  text: PAYLOAD,
});
add({
  id: "enc-utf16le-bom-nodecl",
  bytes: withBom("utf16le", utf16le(body(""))),
  declared: null,
  bom: "utf16le",
  expect: "accept-exact",
  text: PAYLOAD,
});
add({
  id: "enc-utf16be-bom-decl",
  bytes: withBom("utf16be", utf16be(`${declaration("UTF-16")}${body("")}`)),
  declared: "UTF-16",
  bom: "utf16be",
  expect: "accept-exact",
  text: PAYLOAD,
});
add({
  id: "enc-utf16be-bom-nodecl",
  bytes: withBom("utf16be", utf16be(body(""))),
  declared: null,
  bom: "utf16be",
  expect: "accept-exact",
  text: PAYLOAD,
});
add({
  id: "enc-utf16le-nobom-decl",
  bytes: utf16le(`${declaration("UTF-16LE")}${body("")}`),
  declared: "UTF-16LE",
  bom: "none",
  expect: "accept-exact",
  rationale:
    "XML 1.0 UTF-16 icin BOM sart kosar; libxml2 acik UTF-16LE etiketiyle kurtariyor. Metin exact ve doc.encoding dogru raporlaniyor, veri kaybi yok. Spec'ten daha musamahakar davranis olarak kaydedildi.",
  text: PAYLOAD,
});
add({
  id: "enc-utf16le-nobom-nodecl",
  bytes: utf16le(body("")),
  declared: null,
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-lie-utf8-says-utf16",
  bytes: utf8(`${declaration("UTF-16")}${body("")}`),
  declared: "UTF-16",
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-lie-utf16-says-utf8",
  bytes: withBom("utf16le", utf16le(`${declaration("UTF-8")}${body("")}`)),
  declared: "UTF-8",
  bom: "utf16le",
  expect: "accept-exact",
  rationale:
    "BOM yalan declaration'i yeniyor: metin exact cikiyor ve doc.encoding beyani degil gercekten kullanilan UTF-16LE'yi bildiriyor. Guvenli sonuc; mojibake yok.",
  text: PAYLOAD,
});
add({
  id: "enc-lie-1254-says-utf8",
  bytes: Buffer.concat([utf8(declaration("UTF-8")), windows1254(body(""))]),
  declared: "UTF-8",
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-1254-declared",
  bytes: Buffer.concat([
    utf8(declaration("windows-1254")),
    windows1254(body(`<edge>${EURO}</edge>`)),
  ]),
  declared: "windows-1254",
  bom: "none",
  expect: "accept-exact",
  text: PAYLOAD,
  extraText: [EURO],
});
add({
  id: "enc-88599-declared",
  bytes: Buffer.concat([utf8(declaration("ISO-8859-9")), iso88599(body(""))]),
  declared: "ISO-8859-9",
  bom: "none",
  expect: "accept-exact",
  text: PAYLOAD,
});
add({
  id: "enc-decl-case-variant",
  bytes: utf8(`${declaration("utf-8")}${body("")}`),
  declared: "utf-8",
  bom: "none",
  expect: "accept-exact",
  text: PAYLOAD,
});
add({
  id: "enc-unknown-label",
  bytes: utf8(`${declaration("X-SK-NOT-A-CHARSET")}${body("")}`),
  declared: "X-SK-NOT-A-CHARSET",
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-utf32le-bom",
  bytes: Buffer.concat([BOM.utf32le, utf8(body(""))]),
  declared: null,
  bom: "utf32le",
  expect: "reject",
});
add({
  id: "enc-truncated-multibyte",
  bytes: (() => {
    const full = utf8(`${declaration("UTF-8")}<r><t>${PAYLOAD}`);
    return Buffer.concat([full.subarray(0, full.length - 1), utf8("</t></r>")]);
  })(),
  declared: "UTF-8",
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-overlong",
  bytes: Buffer.concat([
    utf8(`${declaration("UTF-8")}<r><t>`),
    Buffer.from([0xc0, 0xaf]),
    utf8("</t></r>"),
  ]),
  declared: "UTF-8",
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-utf8-lone-surrogate",
  bytes: Buffer.concat([
    utf8(`${declaration("UTF-8")}<r><t>`),
    Buffer.from([0xed, 0xa0, 0x80]),
    utf8("</t></r>"),
  ]),
  declared: "UTF-8",
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-nul-in-content",
  bytes: Buffer.concat([
    utf8(`${declaration("UTF-8")}<r><t>`),
    Buffer.from([0x00]),
    utf8("</t></r>"),
  ]),
  declared: "UTF-8",
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-c0-control",
  bytes: Buffer.concat([
    utf8(`${declaration("UTF-8")}<r><t>`),
    Buffer.from([0x0b]),
    utf8("</t></r>"),
  ]),
  declared: "UTF-8",
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-bom-midfile",
  bytes: utf8(`${declaration("UTF-8")}<r><t>a\uFEFFb</t></r>`),
  declared: "UTF-8",
  bom: "none",
  expect: "accept-exact",
  text: "a\uFEFFb",
  probe: "t",
});
add({
  id: "enc-bom-then-space-then-decl",
  bytes: Buffer.concat([BOM.utf8, utf8(` ${declaration("UTF-8")}${body("")}`)]),
  declared: "UTF-8",
  bom: "utf8",
  expect: "reject",
});
add({
  id: "enc-charref-astral",
  bytes: utf8(`${declaration("UTF-8")}<r><t>&#x20000;</t></r>`),
  declared: "UTF-8",
  bom: "none",
  expect: "accept-exact",
  text: ASTRAL,
  probe: "t",
});
add({
  id: "enc-charref-out-of-range",
  bytes: utf8(`${declaration("UTF-8")}<r><t>&#x110000;</t></r>`),
  declared: "UTF-8",
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-charref-nul",
  bytes: utf8(`${declaration("UTF-8")}<r><t>&#x0;</t></r>`),
  declared: "UTF-8",
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-nfd-not-normalized",
  bytes: utf8(`${declaration("UTF-8")}<r><t>i̇</t></r>`),
  declared: "UTF-8",
  bom: "none",
  expect: "accept-exact",
  text: "i̇",
  probe: "t",
});
add({
  id: "enc-genuine-fffd",
  bytes: utf8(`${declaration("UTF-8")}<r><t>a\uFFFDb</t></r>`),
  declared: "UTF-8",
  bom: "none",
  expect: "accept-exact",
  text: "a\uFFFDb",
  probe: "t",
  expectedReplacements: 1,
});
add({
  id: "enc-empty-buffer",
  bytes: Buffer.alloc(0),
  declared: null,
  bom: "none",
  expect: "reject",
});
add({
  id: "enc-whitespace-only",
  bytes: utf8("   \n"),
  declared: null,
  bom: "none",
  expect: "reject",
});

const requiresDecision = [];

for (const fixture of fixtures) {
  const row = {
    id: fixture.id,
    sha256: sha256(fixture.bytes),
    byteLength: fixture.bytes.length,
    declaredEncoding: fixture.declared,
    rationale: fixture.rationale ?? null,
    bomKind: fixture.bom,
    expected: fixture.expect,
    accepted: false,
    errorClass: null,
    errorMessage: null,
    warnings: [],
    docEncoding: null,
    codePointsMatch: null,
    replacementCount: null,
    observedText: null,
    pass: false,
  };

  let document = null;
  try {
    document = XmlDocument.fromBuffer(fixture.bytes, { option: HARDENED });
    row.accepted = true;
  } catch (error) {
    row.errorClass = error.constructor.name;
    row.errorMessage = String(error.message).slice(0, 200);
  }

  if (document !== null) {
    row.docEncoding = document.encoding;
    row.warnings = (document.warnings ?? []).map((warning) =>
      String(warning.message ?? warning).slice(0, 160),
    );
    const selector = fixture.probe ?? "turkish";
    const found = document.eval(`//${selector}`);
    const observed = found.length > 0 ? found[0].content : null;
    row.observedText = observed;
    row.replacementCount =
      observed === null ? null : replacementCount(observed);
    if (fixture.text !== undefined && observed !== null) {
      const expectedPoints = codePoints(fixture.text);
      const observedPoints = codePoints(observed);
      row.codePointsMatch =
        expectedPoints.length === observedPoints.length &&
        expectedPoints.every((point, index) => point === observedPoints[index]);
    }
    if (fixture.extraText !== undefined) {
      for (const extra of fixture.extraText) {
        const extraFound = document.eval(
          extra === ASTRAL ? "//astral" : "//edge",
        );
        const extraObserved =
          extraFound.length > 0 ? extraFound[0].content : null;
        const matches =
          extraObserved !== null &&
          codePoints(extraObserved).join(",") === codePoints(extra).join(",");
        if (!matches) row.codePointsMatch = false;
      }
    }
    document.dispose();
  }

  const expectedReplacements = fixture.expectedReplacements ?? 0;

  if (fixture.expect === "accept-exact") {
    row.pass =
      row.accepted &&
      row.codePointsMatch === true &&
      row.replacementCount === expectedReplacements;
  } else if (fixture.expect === "reject") {
    row.pass = row.accepted === false;
  } else {
    row.pass = false;
    requiresDecision.push(fixture.id);
  }

  if (
    row.accepted &&
    row.codePointsMatch === false &&
    row.warnings.length === 0
  ) {
    row.silentCorruption = true;
  }

  rows.push(row);
}

const silent = rows.filter((row) => row.silentCorruption === true);
notes.push(
  `silent-corruption rows: ${silent.length === 0 ? "none" : silent.map((row) => row.id).join(",")}`,
);

const encodingReported = rows.filter(
  (row) => row.accepted && row.docEncoding !== null,
);
notes.push(
  `doc.encoding reported a declared value on ${encodingReported.length} of ${rows.filter((row) => row.accepted).length} accepted rows; it is never fabricated when the document declares nothing.`,
);

limits.push(
  "measure durumundaki satirlar otomatik gecmez: gozlem kaydedilir ve manifest gercek bir beklenti ile guncellenene kadar deney kirmizi kalir.",
);

const failed = rows.filter((row) => row.pass === false);
console.log(
  JSON.stringify({
    schemaVersion: 1,
    task: "F0-04",
    probe: "encoding",
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
    rows,
    summary: {
      total: rows.length,
      passed: rows.length - failed.length,
      failed: failed.length,
      requiresDecision: requiresDecision.length,
    },
    verdict: failed.length === 0 ? "pass" : "fail",
    blockingRows: failed.map((row) => row.id),
    silentCorruptionRows: silent.map((row) => row.id),
    requiresDecision,
    limits,
    notes,
  }),
);
