import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export const utf8 = (text) => Buffer.from(text, "utf8");

export const utf16le = (text) => Buffer.from(text, "utf16le");

export const utf16be = (text) => {
  const le = Buffer.from(text, "utf16le");
  const be = Buffer.alloc(le.length);
  for (let index = 0; index < le.length; index += 2) {
    be[index] = le[index + 1];
    be[index + 1] = le[index];
  }
  return be;
};

export const BOM = {
  utf8: Buffer.from([0xef, 0xbb, 0xbf]),
  utf16le: Buffer.from([0xff, 0xfe]),
  utf16be: Buffer.from([0xfe, 0xff]),
  utf32le: Buffer.from([0xff, 0xfe, 0x00, 0x00]),
};

export const withBom = (kind, bytes) =>
  kind === "none" ? bytes : Buffer.concat([BOM[kind], bytes]);

const WINDOWS_1254 = new Map([
  [0x20ac, 0x80],
  [0x011f, 0xf0],
  [0x0130, 0xdd],
  [0x0131, 0xfd],
  [0x015f, 0xfe],
  [0x015e, 0xde],
  [0x00c7, 0xc7],
  [0x00e7, 0xe7],
  [0x00d6, 0xd6],
  [0x00f6, 0xf6],
  [0x00dc, 0xdc],
  [0x00fc, 0xfc],
]);

const ISO_8859_9 = new Map([
  [0x011f, 0xf0],
  [0x0130, 0xdd],
  [0x0131, 0xfd],
  [0x015f, 0xfe],
  [0x015e, 0xde],
  [0x00c7, 0xc7],
  [0x00e7, 0xe7],
  [0x00d6, 0xd6],
  [0x00f6, 0xf6],
  [0x00dc, 0xdc],
  [0x00fc, 0xfc],
]);

const singleByte = (table) => (text) => {
  const out = Buffer.alloc([...text].length);
  let index = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    if (point < 0x80) {
      out[index] = point;
    } else if (table.has(point)) {
      out[index] = table.get(point);
    } else {
      throw new Error(`unencodable code point U+${point.toString(16)}`);
    }
    index += 1;
  }
  return out.subarray(0, index);
};

export const windows1254 = singleByte(WINDOWS_1254);
export const iso88599 = singleByte(ISO_8859_9);

export const codePoints = (text) =>
  Array.from(text, (character) => character.codePointAt(0));

export const replacementCount = (text) =>
  codePoints(text).filter((point) => point === 0xfffd).length;

export const namespaceFixtures = () => [
  {
    id: "ns-none",
    isolates: "no namespaces anywhere; every element carries an empty uri",
    source: "<r><total>1</total></r>",
    expected: [{ uri: "", name: "total", text: "1" }],
  },
  {
    id: "ns-default-only",
    isolates:
      "a default namespace inherits to children, and an unprefixed XPath step must not bind to it",
    source: '<r xmlns="urn:x-sk:a"><total>1</total></r>',
    expected: [{ uri: "urn:x-sk:a", name: "total", text: "1" }],
  },
  {
    id: "ns-default-redefined",
    isolates:
      "three default-namespace states in one tree including an undeclaration",
    source:
      '<r xmlns="urn:x-sk:a"><mid xmlns="urn:x-sk:b"><leaf xmlns=""/></mid></r>',
    expected: [
      { uri: "urn:x-sk:a", name: "r", text: "" },
      { uri: "urn:x-sk:b", name: "mid", text: "" },
      { uri: "", name: "leaf", text: "" },
    ],
  },
  {
    id: "ns-prefix-rebound",
    isolates: "the same prefix bound to two different uris at two depths",
    source:
      '<r xmlns:p="urn:x-sk:a"><p:item>outer</p:item><mid xmlns:p="urn:x-sk:b"><p:item>inner</p:item></mid></r>',
    expected: [
      { uri: "urn:x-sk:a", name: "item", text: "outer" },
      { uri: "urn:x-sk:b", name: "item", text: "inner" },
    ],
  },
  {
    id: "ns-prefix-renamed",
    isolates:
      "byte-different twin of ns-prefix-rebound using other prefixes and identical uris",
    source:
      '<r xmlns:x="urn:x-sk:a"><x:item>outer</x:item><mid xmlns:x="urn:x-sk:b"><x:item>inner</x:item></mid></r>',
    expected: [
      { uri: "urn:x-sk:a", name: "item", text: "outer" },
      { uri: "urn:x-sk:b", name: "item", text: "inner" },
    ],
  },
  {
    id: "ns-same-localname-siblings",
    isolates: "one local name across three different namespace identities",
    source:
      '<r xmlns:a="urn:x-sk:a" xmlns:b="urn:x-sk:b"><a:total>1</a:total><b:total>2</b:total><total>3</total></r>',
    expected: [
      { uri: "urn:x-sk:a", name: "total", text: "1" },
      { uri: "urn:x-sk:b", name: "total", text: "2" },
      { uri: "", name: "total", text: "3" },
    ],
  },
  {
    id: "ns-attributes",
    isolates:
      "an unprefixed attribute is in no namespace even when the element is in the default namespace",
    source:
      '<r xmlns="urn:x-sk:a" xmlns:p="urn:x-sk:p" id="u" p:id="q" xml:lang="tr"/>',
    expected: [{ uri: "urn:x-sk:a", name: "r", text: "" }],
  },
  {
    id: "ns-reserved-xml",
    isolates: "the xml prefix is bound implicitly without a declaration",
    source: '<r xml:lang="tr" xml:space="preserve"/>',
    expected: [{ uri: "", name: "r", text: "" }],
  },
];

export const scalarDocument =
  '<r xmlns:a="urn:x-sk:a"><a:total>1</a:total><empty/><text> </text><bigid>00012345678901234567890</bigid><amount>1.10</amount></r>';
