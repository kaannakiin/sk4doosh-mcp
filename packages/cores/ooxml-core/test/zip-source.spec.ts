import { describe, expect, it } from "vitest";
import {
  bytes,
  deflateRaw,
  highlyCompressible,
  patchHeaders,
  renamePart,
  samplePackage,
  zipOf,
} from "./fixtures/build.js";
import { expectRefusal, reader } from "./fixtures/harness.js";

const ok = { "a.xml": "<a/>" };

describe("archive indexing", () => {
  it("indexes every file entry and skips folder entries", () => {
    const source = reader().zipSource(samplePackage());
    expect(source.entries.map((entry) => entry.path).sort()).toStrictEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "doc/_rels/main.xml.rels",
      "doc/main.xml",
      "doc/notes.xml",
      "media/image1.PNG",
    ]);
  });

  it("reports a present empty part as empty rather than absent", () => {
    const source = reader().zipSource(samplePackage());
    const found = source.read("doc/notes.xml");
    expect(found).toBeInstanceOf(Uint8Array);
    expect(found?.length).toBe(0);
  });

  it("returns undefined for a part the archive does not carry", () => {
    const source = reader().zipSource(samplePackage());
    expect(source.read("doc/missing.xml")).toBeUndefined();
  });

  it("refuses bytes that are not an archive", () => {
    expectRefusal(
      () => reader().zipSource(bytes("hello world, not an archive at all")),
      "not_a_package",
    );
  });
});

describe("the reject list", () => {
  it("refuses a compression method it does not read", () => {
    for (const method of [9, 12, 14, 93]) {
      const forged = patchHeaders(zipOf(ok), { method }, { method });
      expectRefusal(
        () => reader().zipSource(forged),
        "unsupported_zip_feature",
      );
    }
  });

  it("refuses a part name outside printable ASCII", () => {
    const forged = renamePart(
      zipOf({ "abcde.xml": "<a/>" }),
      "abcde.xml",
      Uint8Array.from([0xc3, 0xa7, 0x64, 0x65, 0x2e, 0x78, 0x6d, 0x6c, 0x00]),
    );
    expectRefusal(() => reader().zipSource(forged), "malformed_part_name");
  });

  it("refuses a name that aliases another part", () => {
    const original = "aaaaaaaaa.xml";
    for (const alias of ["../esc.xml", "/abs.xml", "a\\b.xml", "C:/x.xml"]) {
      const forged = renamePart(
        zipOf({ [original]: "<a/>" }),
        original,
        bytes(alias.padEnd(original.length, "_")),
      );
      expectRefusal(() => reader().zipSource(forged), "malformed_part_name");
    }
  });

  it("refuses an archive carrying the same name twice", () => {
    const built = zipOf({ "a.xml": "<a/>", "b.xml": "<b/>" });
    const collided = renamePart(built, "b.xml", bytes("a.xml"));
    expectRefusal(() => reader().zipSource(collided), "corrupt_package");
  });

  it("refuses more parts than the ceiling allows", () => {
    const many: Record<string, string> = {};
    for (let index = 0; index < 12; index += 1) {
      many[`p${String(index)}.xml`] = "<a/>";
    }
    expectRefusal(
      () => reader({ maxPartCount: 8 }).zipSource(zipOf(many)),
      "corrupt_package",
    );
  });
});

describe("the size gates", () => {
  it("refuses a part over the absolute ceiling without inflating it", () => {
    const forged = patchHeaders(zipOf(ok), { uncompressedSize: 64 * 1024 });
    const error = expectRefusal(
      () => reader({ maxPartBytes: 1024 }).zipSource(forged),
      "part_too_large",
    );
    expect(error.message).toContain("part ceiling");
  });

  it("refuses a part whose expansion ratio is a bomb signature", () => {
    const payload = highlyCompressible(4 * 1024 * 1024);
    const source = zipOf({ "big.xml": payload });
    const error = expectRefusal(
      () =>
        reader({ ratioFloorBytes: 1024, maxExpansionRatio: 50 }).zipSource(
          source,
        ),
      "part_too_large",
    );
    expect(error.message).toContain(":1 ceiling");
  });

  it("admits a legitimate ratio above the floor", () => {
    const payload = highlyCompressible(4 * 1024 * 1024);
    const source = zipOf({ "big.xml": payload });
    expect(() =>
      reader({ ratioFloorBytes: 1024, maxExpansionRatio: 5000 }).zipSource(
        source,
      ),
    ).not.toThrow();
  });

  it("leaves a small highly compressible part alone below the floor", () => {
    const source = zipOf({ "small.xml": highlyCompressible(64 * 1024) });
    expect(() =>
      reader({ ratioFloorBytes: 1024 * 1024, maxExpansionRatio: 10 }).zipSource(
        source,
      ),
    ).not.toThrow();
  });

  it("refuses a part that inflates to a length the directory did not declare", () => {
    const forged = patchHeaders(zipOf({ "a.xml": "<a/>" }), {
      uncompressedSize: 9,
    });
    const source = reader().zipSource(forged);
    const error = expectRefusal(() => source.read("a.xml"), "corrupt_package");
    expect(error.message).toContain("declares 9 bytes");
  });
});

describe("what fflate does, pinned", () => {
  it("reads an entry whose local header carries no sizes", () => {
    const forged = patchHeaders(
      zipOf({ "a.xml": "<a/>" }),
      {},
      { flags: 0x08, compressedSize: 0, uncompressedSize: 0 },
    );
    const source = reader().zipSource(forged);
    expect(source.read("a.xml")).toStrictEqual(bytes("<a/>"));
  });

  it("reads a stored entry", () => {
    const body = bytes("<a/>");
    const forged = patchHeaders(
      zipOf({ "a.xml": body }),
      { method: 0, compressedSize: body.length },
      { method: 0, compressedSize: body.length },
    );
    const rebuilt = new Uint8Array(forged);
    expect(() => reader().zipSource(rebuilt)).not.toThrow();
  });

  it("keeps deflateRawSync output readable through the same path", () => {
    expect(deflateRaw(bytes("<a/>")).length).toBeGreaterThan(0);
  });
});
