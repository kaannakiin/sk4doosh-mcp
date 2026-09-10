import { readFileSync } from "node:fs";
import { XmlDocument, XmlElement } from "libxml2-wasm";
import { beforeAll, describe, expect, inject, it } from "vitest";
import {
  isRefusal,
  scanRecordBoundaries,
  type BoundaryScan,
} from "../src/boundary.js";
import { wrapRecord } from "../src/fragment.js";
import { HARDENED } from "../src/parse-policy.js";
import { cellsOf, scanItems } from "../src/records.js";
import type {
  Cell,
  ColumnSpec,
  ItemSelector,
  ScanLimits,
} from "../src/query-model.js";
import type { Fixtures } from "./fixtures/build.js";

let fixtures: Fixtures;

const limits: ScanLimits = {
  maxItemVisits: 50_000,
  maxChars: 512,
  maxCellValues: 16,
};

const scanOptions = { maxRecordBytes: 8 * 1024 * 1024, maxSpans: 10_000 };

interface Projection {
  readonly occurrence: number;
  readonly cells: readonly Cell[];
}

function selectorFor(namespaceUri: string): ItemSelector {
  return {
    ancestors: [{ namespaceUri, localName: "catalogue", occurrence: 1 }],
    name: { namespaceUri, localName: "entry" },
  };
}

function columnsFor(namespaceUri: string): readonly ColumnSpec[] {
  return [
    {
      label: "code",
      ancestors: [],
      source: {
        from: "attribute",
        attribute: { namespaceUri: "", localName: "code" },
      },
      onMultiple: "error",
    },
    {
      label: "name",
      ancestors: [],
      name: { namespaceUri, localName: "name" },
      source: { from: "text" },
      onMultiple: "list",
    },
  ];
}

function residentProjection(
  bytes: Buffer,
  selector: ItemSelector,
  columns: readonly ColumnSpec[],
): readonly Projection[] {
  const document = XmlDocument.fromBuffer(bytes, { option: HARDENED });
  try {
    const scan = scanItems(document.root, selector, limits.maxItemVisits);
    if (scan === undefined) throw new Error("the address matched nothing");
    return scan.items.map((visit) => ({
      occurrence: visit.occurrence,
      cells: cellsOf(visit.element, columns, limits),
    }));
  } finally {
    document.dispose();
  }
}

function chunkedProjection(
  bytes: Buffer,
  scan: BoundaryScan,
  columns: readonly ColumnSpec[],
): readonly Projection[] {
  const projections: Projection[] = [];
  for (let i = 0; i < scan.offsets.length; i += 2) {
    const fragment = wrapRecord(
      bytes,
      scan.offsets[i] as number,
      scan.offsets[i + 1] as number,
      scan.context,
    );
    const document = XmlDocument.fromBuffer(Buffer.from(fragment), {
      option: HARDENED,
    });
    try {
      let child = document.root.firstChild;
      while (child !== null && !(child instanceof XmlElement))
        child = child.next;
      if (!(child instanceof XmlElement))
        throw new Error("the fragment carried no record element");
      projections.push({
        occurrence: i / 2 + 1,
        cells: cellsOf(child, columns, limits),
      });
    } finally {
      document.dispose();
    }
  }
  return projections;
}

function oracle(path: string, namespaceUri = ""): void {
  const bytes = readFileSync(path);
  const selector = selectorFor(namespaceUri);
  const columns = columnsFor(namespaceUri);
  const scan = scanRecordBoundaries(bytes, selector, scanOptions);
  if (isRefusal(scan)) throw new Error(`scan refused: ${scan.reason}`);
  expect(chunkedProjection(bytes, scan, columns)).toStrictEqual(
    residentProjection(bytes, selector, columns),
  );
}

beforeAll(() => {
  fixtures = inject("fixtures");
});

describe("the resident and chunked tiers agree", () => {
  it("on a plain record document", () => {
    oracle(fixtures.records);
  });

  it("on a namespaced document with inherited xml:lang and xml:space", () => {
    oracle(fixtures.recordsNamespaced, "urn:cat");
  });

  it("on a wide document", () => {
    oracle(fixtures.wideQuery);
  });
});

describe("a false boundary never becomes a wrong chunk", () => {
  it("ignores a record tag inside CDATA", () => {
    oracle(fixtures.cdataFalseBoundary);
  });

  it("ignores a record tag inside a comment", () => {
    oracle(fixtures.commentFalseBoundary);
  });

  it("does not end a tag on a > or /> inside an attribute, in either quote style", () => {
    oracle(fixtures.attrFalseBoundary);
  });

  it("ignores a record tag inside a processing instruction", () => {
    oracle(fixtures.piFalseBoundary);
  });

  it("counts depth rather than matching names, so a nested record is not a sibling", () => {
    oracle(fixtures.nestedSameName);
  });
});

describe("the chunked tier refuses what it cannot cut", () => {
  it("refuses UTF-16 rather than cutting on a two-byte marker", () => {
    const outcome = scanRecordBoundaries(
      readFileSync(fixtures.recordsUtf16),
      selectorFor(""),
      scanOptions,
    );
    expect(outcome).toStrictEqual({ reason: "utf16" });
  });

  it("refuses a declared encoding the fragment would lose", () => {
    const outcome = scanRecordBoundaries(
      readFileSync(fixtures.recordsLatin),
      selectorFor(""),
      scanOptions,
    );
    expect(outcome).toStrictEqual({
      reason: "unsupported_encoding",
      declared: "windows-1254",
    });
  });

  it("refuses a record that alone exceeds the chunk budget", () => {
    const outcome = scanRecordBoundaries(
      readFileSync(fixtures.records),
      selectorFor(""),
      { ...scanOptions, maxRecordBytes: 8 },
    );
    expect(outcome).toMatchObject({ reason: "record_too_large" });
  });

  it("refuses an address that matches no repeating record", () => {
    const outcome = scanRecordBoundaries(
      readFileSync(fixtures.records),
      {
        ancestors: [
          { namespaceUri: "", localName: "catalogue", occurrence: 1 },
        ],
        name: { namespaceUri: "", localName: "absent" },
      },
      scanOptions,
    );
    expect(outcome).toStrictEqual({ reason: "not_record_shaped" });
  });
});
