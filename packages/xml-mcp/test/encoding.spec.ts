import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { detectByteOrderMark } from "@sk-mcp/file-core";
import { scanProlog, unsupportedPrologEncoding } from "../src/doctype.js";
import { limits } from "../src/limits.js";
import type { Fixtures } from "./fixtures/build.js";
import { bodyOf, createHarness, type Harness } from "./fixtures/harness.js";

let fixtures: Fixtures;
let harness: Harness;

async function describeDoc(filePath: string) {
  const result = await harness.handlers.describe_document({
    filePath,
  } as Parameters<Harness["handlers"]["describe_document"]>[0]);
  return { isError: result.isError === true, body: bodyOf(result) };
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("prolog autodetection", () => {
  it("names every four-byte signature the scanner cannot decode", () => {
    const cases: readonly [readonly number[], string][] = [
      [[0x00, 0x00, 0xfe, 0xff], "ucs-4be"],
      [[0xff, 0xfe, 0x00, 0x00], "ucs-4le"],
      [[0x00, 0x00, 0xff, 0xfe], "ucs-4-2143"],
      [[0xfe, 0xff, 0x00, 0x00], "ucs-4-3412"],
      [[0x00, 0x00, 0x00, 0x3c], "ucs-4be"],
      [[0x3c, 0x00, 0x00, 0x00], "ucs-4le"],
      [[0x4c, 0x6f, 0xa7, 0x94], "ebcdic"],
    ];
    for (const [bytes, expected] of cases) {
      expect(unsupportedPrologEncoding(Buffer.from(bytes))).toBe(expected);
    }
  });

  it("leaves the encodings it can decode alone", () => {
    expect(
      unsupportedPrologEncoding(Buffer.from('<?xml version="1.0"?>', "utf8")),
    ).toBeUndefined();
    expect(
      unsupportedPrologEncoding(
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from("<catalog/>", "utf16le"),
        ]),
      ),
    ).toBeUndefined();
  });

  it("refuses a mark the prolog decoder has no branch for", () => {
    const utf32le = Buffer.from([
      0xff, 0xfe, 0x00, 0x00, 0x3c, 0x00, 0x00, 0x00,
    ]);
    expect(detectByteOrderMark(utf32le)?.encoding).toBe("utf-32le");
    expect(unsupportedPrologEncoding(utf32le)).toBe("ucs-4le");
    expect(
      scanProlog(utf32le, limits.prologScanBytes).unsupportedEncoding,
    ).toBe("ucs-4le");
  });

  it("catches the signatures that carry no mark at all", () => {
    const utf32beNoMark = Buffer.from([
      0x00, 0x00, 0x00, 0x3c, 0x00, 0x00, 0x00, 0x3f,
    ]);
    expect(detectByteOrderMark(utf32beNoMark)).toBeUndefined();
    expect(unsupportedPrologEncoding(utf32beNoMark)).toBe("ucs-4be");
  });
});

describe("documents in an encoding the server cannot read", () => {
  it("refuses a utf-32le document that hides a DOCTYPE", async () => {
    const bytes = await readFile(fixtures.utf32leDoctype);
    const scan = scanProlog(bytes, limits.prologScanBytes);
    expect(scan.unsupportedEncoding).toBe("ucs-4le");

    const outcome = await describeDoc(basename(fixtures.utf32leDoctype));
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("unsupported_encoding");
  });

  it("refuses a utf-32be document that hides a DOCTYPE", async () => {
    const outcome = await describeDoc(basename(fixtures.utf32beDoctype));
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("unsupported_encoding");
  });

  it("refuses an EBCDIC prolog", async () => {
    const outcome = await describeDoc(basename(fixtures.ebcdicDoctype));
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("unsupported_encoding");
  });

  it("refuses a clean utf-32 document too, rather than guessing at it", async () => {
    const outcome = await describeDoc(basename(fixtures.utf32leClean));
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("unsupported_encoding");
  });

  it("never falls through to the doc.dtd backstop for these families", async () => {
    for (const path of [
      fixtures.utf32leDoctype,
      fixtures.utf32beDoctype,
      fixtures.ebcdicDoctype,
    ]) {
      const outcome = await describeDoc(basename(path));
      expect(outcome.body["error"]).not.toBe("doctype_not_allowed");
      expect(outcome.body["error"]).not.toBe("malformed_xml");
    }
  });
});
