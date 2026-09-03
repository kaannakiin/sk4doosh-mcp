import { describe, expect, it } from "vitest";
import { buildColumnIndex, resolveColumn } from "../src/columns.js";
import type { SkMcpExcelError } from "../src/errors.js";
import type { GridBounds } from "../src/range.js";

const bounds: GridBounds = { top: 1, left: 1, bottom: 10, right: 8 };
const headers = ["Region", "Total", "Date", "B", "Total", "", null, "İSTANBUL"];

const index = buildColumnIndex("Sales!A1:H10", bounds, 1, headers);
const letterOnly = buildColumnIndex(
  "Sales!A1:H10",
  bounds,
  0,
  headers.map(() => null),
);

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return (error as SkMcpExcelError).code;
  }
  return "no-error";
}

describe("resolution", () => {
  it("resolves by header, folded", () => {
    expect(resolveColumn(index, "Region")).toBe(1);
    expect(resolveColumn(index, "region")).toBe(1);
    expect(resolveColumn(index, "istanbul")).toBe(8);
    expect(resolveColumn(index, "ıstanbul")).toBe(8);
  });

  it("falls back to the A1 letter", () => {
    expect(resolveColumn(index, "C")).toBe(3);
    expect(resolveColumn(index, "h")).toBe(8);
  });
});

describe("conflicts are errors", () => {
  it("refuses a duplicate header and names both letters", () => {
    expect(codeOf(() => resolveColumn(index, "Total"))).toBe(
      "ambiguous_column",
    );
    try {
      resolveColumn(index, "Total");
    } catch (error) {
      expect((error as SkMcpExcelError).recovery).toContain('"B"');
      expect((error as SkMcpExcelError).recovery).toContain('"E"');
    }
  });

  it("refuses a header that collides with a letter", () => {
    expect(codeOf(() => resolveColumn(index, "B"))).toBe("ambiguous_column");
  });

  it("columnMode breaks the header/letter collision both ways", () => {
    expect(resolveColumn(index, "B", "header")).toBe(4);
    expect(resolveColumn(index, "B", "letter")).toBe(2);
  });

  it("columnMode header still refuses a duplicate header", () => {
    expect(codeOf(() => resolveColumn(index, "Total", "header"))).toBe(
      "ambiguous_column",
    );
  });
});

describe("columns without header text", () => {
  it("is letter-addressable only", () => {
    expect(resolveColumn(index, "F")).toBe(6);
    expect(resolveColumn(index, "G")).toBe(7);
    expect(codeOf(() => resolveColumn(index, "2026"))).toBe("unknown_column");
  });

  it("explains that headerRow is 0", () => {
    expect(codeOf(() => resolveColumn(letterOnly, "Region"))).toBe(
      "unknown_column",
    );
    try {
      resolveColumn(letterOnly, "Region");
    } catch (error) {
      expect((error as SkMcpExcelError).recovery).toContain("headerRow is 0");
    }
  });
});

describe("unknown columns", () => {
  it("lists the resolvable columns", () => {
    try {
      resolveColumn(index, "Nope");
      expect.unreachable();
    } catch (error) {
      const failure = error as SkMcpExcelError;
      expect(failure.code).toBe("unknown_column");
      expect(failure.message).toContain("Sales!A1:H10");
      expect(failure.recovery).toContain("A (Region)");
      expect(failure.recovery).toContain("A..H");
    }
  });

  it("refuses a letter outside the range", () => {
    expect(codeOf(() => resolveColumn(index, "Z", "letter"))).toBe(
      "unknown_column",
    );
  });
});
