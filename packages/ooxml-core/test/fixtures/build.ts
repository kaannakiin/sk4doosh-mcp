import { deflateRawSync } from "node:zlib";
import { zipSync } from "fflate";

export const centralSignature = 0x02014b50;
export const localSignature = 0x04034b50;

const encoder = new TextEncoder();

export function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function zipOf(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(files)) {
    entries[name] = typeof body === "string" ? bytes(body) : body;
  }
  return zipSync(entries);
}

function readU32(buffer: Uint8Array, at: number): number {
  return (
    ((buffer[at] ?? 0) |
      ((buffer[at + 1] ?? 0) << 8) |
      ((buffer[at + 2] ?? 0) << 16) |
      ((buffer[at + 3] ?? 0) << 24)) >>>
    0
  );
}

function writeU32(buffer: Uint8Array, at: number, value: number): void {
  buffer[at] = value & 0xff;
  buffer[at + 1] = (value >>> 8) & 0xff;
  buffer[at + 2] = (value >>> 16) & 0xff;
  buffer[at + 3] = (value >>> 24) & 0xff;
}

function writeU16(buffer: Uint8Array, at: number, value: number): void {
  buffer[at] = value & 0xff;
  buffer[at + 1] = (value >>> 8) & 0xff;
}

export interface HeaderPatch {
  readonly flags?: number;
  readonly method?: number;
  readonly compressedSize?: number;
  readonly uncompressedSize?: number;
}

/**
 * Rewrites fields of every central-directory header, and optionally of every
 * local header, so a spec can forge the values the reader's gates run on.
 */
export function patchHeaders(
  archive: Uint8Array,
  central: HeaderPatch,
  local: HeaderPatch = {},
): Uint8Array {
  const out = Uint8Array.from(archive);
  for (let at = 0; at + 4 <= out.length; at += 1) {
    const signature = readU32(out, at);
    if (signature === centralSignature) {
      if (central.flags !== undefined) writeU16(out, at + 8, central.flags);
      if (central.method !== undefined) writeU16(out, at + 10, central.method);
      if (central.compressedSize !== undefined) {
        writeU32(out, at + 20, central.compressedSize);
      }
      if (central.uncompressedSize !== undefined) {
        writeU32(out, at + 24, central.uncompressedSize);
      }
    }
    if (signature === localSignature) {
      if (local.flags !== undefined) writeU16(out, at + 6, local.flags);
      if (local.method !== undefined) writeU16(out, at + 8, local.method);
      if (local.compressedSize !== undefined) {
        writeU32(out, at + 18, local.compressedSize);
      }
      if (local.uncompressedSize !== undefined) {
        writeU32(out, at + 22, local.uncompressedSize);
      }
    }
  }
  return out;
}

/** Replaces the first occurrence of a part name, so a spec can forge an illegal one. */
export function renamePart(
  archive: Uint8Array,
  from: string,
  to: Uint8Array,
): Uint8Array {
  const needle = bytes(from);
  if (needle.length !== to.length) {
    throw new Error("the forged name must be the same length");
  }
  const out = Uint8Array.from(archive);
  for (let at = 0; at + needle.length <= out.length; at += 1) {
    let hit = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (out[at + index] !== needle[index]) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;
    out.set(to, at);
  }
  return out;
}

export const minimalContentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="PNG" ContentType="image/png"/>
  <Override PartName="/doc/main.xml" ContentType="application/vnd.custom.main+xml"/>
</Types>`;

export const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://example.test/main" Target="doc/main.xml"/>
  <Relationship Id="rId2" Type="http://example.test/site" Target="https://example.test/x" TargetMode="External"/>
</Relationships>`;

export const mainRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://example.test/image" Target="../media/image1.PNG"/>
  <Relationship Id="rId2" Type="http://example.test/abs" Target="/doc/notes.xml"/>
  <Relationship Id="rId3" Type="http://example.test/up" Target="../../escape.xml"/>
</Relationships>`;

/** A synthetic OPC package with no format vocabulary in it. */
export function samplePackage(): Uint8Array {
  return zipOf({
    "[Content_Types].xml": minimalContentTypes,
    "_rels/.rels": packageRels,
    "doc/main.xml": `<?xml version="1.0"?><main xmlns="http://example.test/ns"><body/></main>`,
    "doc/_rels/main.xml.rels": mainRels,
    "doc/notes.xml": "",
    "media/image1.PNG": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  });
}

/** A part body that deflates far past the ratio ceiling. */
export function highlyCompressible(size: number): Uint8Array {
  return new Uint8Array(size);
}

export function deflateRaw(input: Uint8Array): Uint8Array {
  return new Uint8Array(deflateRawSync(input));
}
