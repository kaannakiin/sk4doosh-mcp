import { Buffer } from "node:buffer";
import { XmlDocument, ParseOption } from "libxml2-wasm";

const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

const MiB = 1024 * 1024;

function flat(targetBytes) {
  const parts = ["<w>"];
  let size = 3;
  let index = 0;
  while (size < targetBytes) {
    const chunk = `<i id="${index}">value ${index}</i>`;
    parts.push(chunk);
    size += chunk.length;
    index += 1;
  }
  parts.push("</w>");
  return Buffer.from(parts.join(""), "utf8");
}

function attributes(targetBytes) {
  const parts = ["<w>"];
  let size = 3;
  let index = 0;
  while (size < targetBytes) {
    const pairs = Array.from(
      { length: 20 },
      (_, slot) => `a${slot}="v${index}-${slot}"`,
    ).join(" ");
    const chunk = `<i ${pairs}/>`;
    parts.push(chunk);
    size += chunk.length;
    index += 1;
  }
  parts.push("</w>");
  return Buffer.from(parts.join(""), "utf8");
}

function deep(targetBytes) {
  const depth = 120;
  const open = "<n>".repeat(depth);
  const close = "</n>".repeat(depth);
  const parts = ["<w>"];
  let size = 3;
  while (size < targetBytes) {
    const chunk = `${open}leaf${close}`;
    parts.push(chunk);
    size += chunk.length;
  }
  parts.push("</w>");
  return Buffer.from(parts.join(""), "utf8");
}

const shapes = { flat, attributes, deep };

const shape = process.argv[2];
const residency = Number(process.argv[3] ?? "5");
const build = shapes[shape];
if (build === undefined) {
  throw new Error(`unknown shape ${String(shape)}`);
}

const settle = () => {
  if (typeof globalThis.gc === "function") globalThis.gc();
};

const document = build(1 * MiB);
const held = [];
const deltas = [];

settle();
let previous = process.memoryUsage.rss();
for (let copy = 0; copy < residency; copy += 1) {
  held.push(XmlDocument.fromBuffer(document, { option: HARDENED }));
  settle();
  const now = process.memoryUsage.rss();
  if (copy > 0) deltas.push(now - previous);
  previous = now;
}
for (const parsed of held) parsed.dispose();

process.stdout.write(
  JSON.stringify({
    shape,
    residency,
    sourceBytes: document.length,
    marginalDeltas: deltas,
  }),
);
