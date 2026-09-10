import { describe, expect, it } from "vitest";
import {
  isRefusal,
  scanRecordBoundaries,
  surveyShape,
  type BoundaryScan,
  type ScanOptions,
} from "../src/boundary.js";
import { wrapperPrefix, wrapRecord } from "../src/fragment.js";
import type { ItemSelector } from "../src/query-model.js";

const options: ScanOptions = { maxRecordBytes: 1024, maxSpans: 100 };

const selector: ItemSelector = {
  ancestors: [{ namespaceUri: "", localName: "catalogue", occurrence: 1 }],
  name: { namespaceUri: "", localName: "entry" },
};

const bytes = (source: string): Uint8Array =>
  new Uint8Array(Buffer.from(source, "utf8"));

function scanned(
  source: string,
  overrides?: Partial<ScanOptions>,
): BoundaryScan {
  const outcome = scanRecordBoundaries(bytes(source), selector, {
    ...options,
    ...overrides,
  });
  if (isRefusal(outcome)) throw new Error(`refused: ${outcome.reason}`);
  return outcome;
}

function slices(source: string, scan: BoundaryScan): readonly string[] {
  const raw = Buffer.from(source, "utf8");
  const out: string[] = [];
  for (let i = 0; i < scan.offsets.length; i += 2)
    out.push(
      raw.subarray(scan.offsets[i], scan.offsets[i + 1]).toString("utf8"),
    );
  return out;
}

describe("the span table", () => {
  it("cuts on the record boundary, self-closing records included", () => {
    const source = "<catalogue><entry a='1'/><entry>text</entry></catalogue>";
    expect(slices(source, scanned(source))).toStrictEqual([
      "<entry a='1'/>",
      "<entry>text</entry>",
    ]);
  });

  it("keeps spans in document order, pairwise disjoint", () => {
    const source = `<catalogue>${"<entry>x</entry>".repeat(20)}</catalogue>`;
    const scan = scanned(source);
    expect(scan.offsets).toHaveLength(40);
    for (let i = 0; i + 2 < scan.offsets.length; i += 2) {
      expect(scan.offsets[i]).toBeLessThan(scan.offsets[i + 1] as number);
      expect(scan.offsets[i + 1]).toBeLessThanOrEqual(
        scan.offsets[i + 2] as number,
      );
    }
  });

  it("reports an incomplete scan when it runs out of span budget", () => {
    const source = `<catalogue>${"<entry>x</entry>".repeat(20)}</catalogue>`;
    const scan = scanned(source, { maxSpans: 5 });
    expect(scan.complete).toBe(false);
    expect(scan.offsets.length / 2).toBeLessThanOrEqual(6);
  });

  it("takes only the addressed depth, never a nested namesake", () => {
    const source =
      "<catalogue><entry><entry>inner</entry></entry><entry>b</entry></catalogue>";
    expect(slices(source, scanned(source))).toStrictEqual([
      "<entry><entry>inner</entry></entry>",
      "<entry>b</entry>",
    ]);
  });

  it("honours the occurrence on an ancestor step", () => {
    const source =
      "<root><catalogue><entry>a</entry></catalogue>" +
      "<catalogue><entry>b</entry></catalogue></root>";
    const second = scanRecordBoundaries(
      bytes(source),
      {
        ancestors: [
          { namespaceUri: "", localName: "root", occurrence: 1 },
          { namespaceUri: "", localName: "catalogue", occurrence: 2 },
        ],
        name: { namespaceUri: "", localName: "entry" },
      },
      options,
    );
    if (isRefusal(second)) throw new Error(second.reason);
    expect(slices(source, second)).toStrictEqual(["<entry>b</entry>"]);
  });
});

describe("the scanner refuses rather than guessing", () => {
  it("refuses an unterminated comment", () => {
    const outcome = scanRecordBoundaries(
      bytes("<catalogue><entry><!-- open </entry></catalogue>"),
      selector,
      options,
    );
    expect(outcome).toMatchObject({ reason: "malformed" });
  });

  it("refuses an unterminated CDATA section", () => {
    const outcome = scanRecordBoundaries(
      bytes("<catalogue><entry><![CDATA[ open </entry></catalogue>"),
      selector,
      options,
    );
    expect(outcome).toMatchObject({ reason: "malformed" });
  });

  it("refuses a declaration it does not model, rather than skipping it", () => {
    const outcome = scanRecordBoundaries(
      bytes("<!DOCTYPE catalogue><catalogue><entry>a</entry></catalogue>"),
      selector,
      options,
    );
    expect(outcome).toMatchObject({ reason: "malformed" });
  });

  it("refuses an unclosed element", () => {
    const outcome = scanRecordBoundaries(
      bytes("<catalogue><entry>a</entry>"),
      selector,
      options,
    );
    expect(outcome).toMatchObject({ reason: "malformed" });
  });
});

describe("the inherited context", () => {
  it("carries ancestor declarations and xml:* down to the fragment", () => {
    const source =
      '<catalogue xmlns="urn:cat" xmlns:m="urn:meta" xml:lang="tr">' +
      "<entry>a</entry></catalogue>";
    const scan = scanRecordBoundaries(
      bytes(source),
      {
        ancestors: [
          { namespaceUri: "urn:cat", localName: "catalogue", occurrence: 1 },
        ],
        name: { namespaceUri: "urn:cat", localName: "entry" },
      },
      options,
    );
    if (isRefusal(scan)) throw new Error(scan.reason);
    const fragment = Buffer.from(
      wrapRecord(
        bytes(source),
        scan.offsets[0] as number,
        scan.offsets[1] as number,
        scan.context,
      ),
    ).toString("utf8");
    expect(fragment).toContain('xmlns="urn:cat"');
    expect(fragment).toContain('xmlns:m="urn:meta"');
    expect(fragment).toContain('xml:lang="tr"');
    expect(fragment).toContain("<entry>a</entry>");
  });

  it("picks a wrapper prefix that the document has not taken", () => {
    expect(wrapperPrefix({ namespaces: [] })).toBe("skmcp");
    expect(
      wrapperPrefix({
        namespaces: [{ prefix: "skmcp", uri: "urn:x", source: "" }],
      }),
    ).toBe("skmcp0");
  });
});

describe("the shape survey", () => {
  it("counts the repeating children of the document element", () => {
    const outcome = surveyShape(
      bytes(
        "<catalogue><meta>m</meta><entry>a</entry><entry>b</entry>" +
          "<entry>c</entry></catalogue>",
      ),
      { maxCandidates: 8 },
    );
    if (isRefusal(outcome)) throw new Error(outcome.reason);
    expect(outcome.root).toMatchObject({
      namespaceUri: "",
      localName: "catalogue",
    });
    expect(outcome.candidates).toStrictEqual([
      { name: { namespaceUri: "", localName: "entry" }, count: 3 },
      { name: { namespaceUri: "", localName: "meta" }, count: 1 },
    ]);
  });

  it("reports no candidate for a document with a single deep branch", () => {
    const outcome = surveyShape(bytes("<a><b><c><d>x</d></c></b></a>"), {
      maxCandidates: 8,
    });
    if (isRefusal(outcome)) throw new Error(outcome.reason);
    expect(outcome.candidates).toStrictEqual([
      { name: { namespaceUri: "", localName: "b" }, count: 1 },
    ]);
  });
});
