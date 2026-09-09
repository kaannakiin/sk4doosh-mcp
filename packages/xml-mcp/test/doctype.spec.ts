import { readFile } from "node:fs/promises";
import { describe, expect, inject, it } from "vitest";
import { scanProlog } from "../src/doctype.js";
import { limits } from "../src/limits.js";

const scan = (text: string) =>
  scanProlog(Buffer.from(text, "utf8"), limits.prologScanBytes);

describe("the prolog DOCTYPE scanner", () => {
  it("finds a real declaration after a prolog", () => {
    expect(scan('<?xml version="1.0"?><!DOCTYPE r><r/>').doctype).toBe(true);
  });

  it("finds a declaration carrying an internal subset", () => {
    expect(scan('<!DOCTYPE r [<!ENTITY x "y">]><r>&x;</r>').doctype).toBe(true);
  });

  it("does not mistake a comment for a declaration", () => {
    expect(scan("<!-- <!DOCTYPE trap> --><r/>").doctype).toBe(false);
  });

  it("does not mistake CDATA text for a declaration", () => {
    expect(scan("<r><![CDATA[<!DOCTYPE trap>]]></r>").doctype).toBe(false);
  });

  it("does not mistake a processing instruction for a declaration", () => {
    expect(scan("<?ignore <!DOCTYPE trap> ?><r/>").doctype).toBe(false);
  });

  it("stops structurally at the root start tag", () => {
    expect(scan("<r><!DOCTYPE nope></r>").doctype).toBe(false);
  });

  it("reads a utf-16le declaration that a byte regex would miss", async () => {
    const fixtures = inject("fixtures");
    const bytes = await readFile(fixtures.doctypeUtf16);
    expect(scanProlog(bytes, limits.prologScanBytes).doctype).toBe(true);
  });

  it("escalates past the window rather than reporting absence", () => {
    const padded = `<!--${" ".repeat(200_000)}--><!DOCTYPE r><r/>`;
    const bytes = Buffer.from(padded, "utf8");
    expect(bytes.length).toBeGreaterThan(limits.prologScanBytes);
    const result = scanProlog(bytes, limits.prologScanBytes);
    expect(result.doctype).toBe(true);
    expect(result.limitReached).toBe(false);
  });

  it("treats a document with no declaration as clean", () => {
    expect(scan('<?xml version="1.0"?><catalog/>')).toEqual({
      doctype: false,
      limitReached: false,
    });
  });
});
