import { describe, expect, it } from "vitest";
import { SkMcpExcelError } from "../src/errors.js";
import {
  advance,
  columnToLetters,
  formatCellRef,
  lettersToColumn,
  parseCellRef,
  resolveRange,
  type GridBounds,
} from "../src/range.js";

const used: GridBounds = { top: 1, left: 1, bottom: 100, right: 10 };

describe("column letters", () => {
  it("maps indices to letters", () => {
    expect(columnToLetters(1)).toBe("A");
    expect(columnToLetters(26)).toBe("Z");
    expect(columnToLetters(27)).toBe("AA");
    expect(columnToLetters(702)).toBe("ZZ");
    expect(columnToLetters(703)).toBe("AAA");
  });

  it("round-trips the first thousand columns", () => {
    for (let index = 1; index <= 1000; index += 1) {
      expect(lettersToColumn(columnToLetters(index))).toBe(index);
    }
  });
});

describe("parseCellRef", () => {
  it("parses references", () => {
    expect(parseCellRef("A1")).toEqual({ row: 1, column: 1 });
    expect(parseCellRef("AA10")).toEqual({ row: 10, column: 27 });
    expect(parseCellRef("ZZ1")).toEqual({ row: 1, column: 702 });
  });

  it.each(["1A", "A0", "$A$1", "", "A", "1"])("rejects %s", (reference) => {
    expect(() => parseCellRef(reference)).toThrowError(SkMcpExcelError);
  });

  it("formats back", () => {
    expect(formatCellRef(10, 27)).toBe("AA10");
  });
});

describe("resolveRange", () => {
  it("defaults to the used range", () => {
    expect(resolveRange(used, undefined)).toEqual(used);
  });

  it("accepts a cell pair", () => {
    expect(resolveRange(used, "B2:D40")).toEqual({
      top: 2,
      left: 2,
      bottom: 40,
      right: 4,
    });
  });

  it("accepts a single cell", () => {
    expect(resolveRange(used, "C5")).toEqual({
      top: 5,
      left: 3,
      bottom: 5,
      right: 3,
    });
  });

  it("accepts column-only and row-only forms", () => {
    expect(resolveRange(used, "B:D")).toEqual({
      top: 1,
      left: 2,
      bottom: 100,
      right: 4,
    });
    expect(resolveRange(used, "2:40")).toEqual({
      top: 2,
      left: 1,
      bottom: 40,
      right: 10,
    });
  });

  it("accepts an open end", () => {
    expect(resolveRange(used, "B2:")).toEqual({
      top: 2,
      left: 2,
      bottom: 100,
      right: 10,
    });
  });

  it("clamps beyond the used range", () => {
    expect(resolveRange(used, "A1:ZZ9999")).toEqual(used);
  });

  it("rejects an inverted range", () => {
    expect(() => resolveRange(used, "D40:B2")).toThrowError(
      /ends before it starts/,
    );
  });

  it("rejects a range fully outside the used range", () => {
    try {
      resolveRange(used, "M900:P950");
      expect.unreachable();
    } catch (error) {
      expect((error as SkMcpExcelError).code).toBe("range_outside_used_range");
      expect((error as SkMcpExcelError).recovery).toContain("A1:J100");
    }
  });
});

describe("advance", () => {
  it("moves to the first row of the next page", () => {
    const bounds: GridBounds = { top: 1, left: 1, bottom: 10, right: 3 };
    expect(advance(bounds, 9)).toEqual({ row: 4, column: 1 });
  });

  it("returns undefined at the end", () => {
    const bounds: GridBounds = { top: 1, left: 1, bottom: 2, right: 3 };
    expect(advance(bounds, 6)).toBeUndefined();
  });
});
