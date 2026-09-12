import { describe, expect, it } from "vitest";
import { normalizeCell, type NormalizeOptions } from "../src/cell-value.js";
import { sheetjsSnapshot, type SheetJsCell } from "../src/sheetjs-cell.js";
import { limits } from "../src/limits.js";

const values: NormalizeOptions = {
  valueMode: "values",
  mergePolicy: "master",
  includeHyperlinks: false,
};

const snapshot = (cell: Partial<SheetJsCell>, merged = false) =>
  sheetjsSnapshot(cell as SheetJsCell, merged);

describe("scalars", () => {
  it("keeps null and empty string apart", () => {
    expect(normalizeCell(snapshot({ t: "z" }), values).value).toBeNull();
    expect(normalizeCell(snapshot({}), values).value).toBeNull();
    expect(normalizeCell(snapshot({ t: "s", v: "" }), values).value).toBe("");
  });

  it("passes numbers and booleans through", () => {
    expect(normalizeCell(snapshot({ t: "n", v: 0 }), values).value).toBe(0);
    expect(normalizeCell(snapshot({ t: "b", v: false }), values).value).toBe(
      false,
    );
  });

  it("renders a midnight date as a calendar day", () => {
    const cell = snapshot({
      t: "d",
      v: new Date(Date.UTC(2026, 0, 15)),
      z: "yyyy-mm-dd",
    });
    expect(normalizeCell(cell, values).value).toBe("2026-01-15");
  });

  it("renders a timed date as a full instant", () => {
    const cell = snapshot({
      t: "d",
      v: new Date(Date.UTC(2026, 0, 15, 9, 30)),
      z: "yyyy-mm-dd hh:mm",
    });
    expect(normalizeCell(cell, values).value).toBe("2026-01-15T09:30:00.000Z");
  });

  it("keeps the instant when the format carries a time token", () => {
    const cell = snapshot({
      t: "d",
      v: new Date(Date.UTC(2026, 0, 15)),
      z: "yyyy-mm-dd hh:mm",
    });
    expect(normalizeCell(cell, values).value).toBe("2026-01-15T00:00:00.000Z");
  });

  it("tags error cells from the cached text", () => {
    const cell = snapshot({ t: "e", v: 0x07, w: "#DIV/0!" });
    expect(normalizeCell(cell, values).value).toEqual({ error: "#DIV/0!" });
  });

  it("names an error cell that carries no cached text", () => {
    expect(normalizeCell(snapshot({ t: "e", v: 0x2a }), values).value).toEqual({
      error: "#N/A",
    });
  });

  it("returns hyperlink text and hides the href by default", () => {
    const cell = snapshot({
      t: "s",
      v: "Docs",
      l: { Target: "https://example.test" },
    });
    expect(normalizeCell(cell, values)).toEqual({ value: "Docs" });
    expect(normalizeCell(cell, { ...values, includeHyperlinks: true })).toEqual(
      {
        value: "Docs",
        note: { kind: "hyperlink", href: "https://example.test" },
      },
    );
  });

  it("truncates long strings and records the original length", () => {
    const text = "x".repeat(limits.maxStringChars + 7);
    const result = normalizeCell(snapshot({ t: "s", v: text }), values);
    expect(String(result.value)).toHaveLength(limits.maxStringChars);
    expect(result.note).toEqual({ kind: "truncated", length: text.length });
  });
});

describe("merged cells", () => {
  it("blanks continuation cells under the master policy", () => {
    expect(
      normalizeCell(snapshot({ t: "s", v: "merged" }, true), values).value,
    ).toBeNull();
  });

  it("repeats the master value when asked", () => {
    const result = normalizeCell(snapshot({ t: "s", v: "merged" }, true), {
      ...values,
      mergePolicy: "repeat",
    });
    expect(result.value).toBe("merged");
  });
});

describe("formulas", () => {
  const formulaCell = (cached: number | boolean | undefined) =>
    snapshot({
      f: "SUM(A1:A2)",
      ...(cached === undefined
        ? {}
        : { t: typeof cached === "number" ? "n" : "b", v: cached }),
    });

  it("returns the cached value", () => {
    expect(normalizeCell(formulaCell(7), values)).toEqual({ value: 7 });
  });

  it("keeps a cached zero", () => {
    expect(normalizeCell(formulaCell(0), values)).toEqual({ value: 0 });
  });

  it("keeps a cached false", () => {
    expect(normalizeCell(formulaCell(false), values)).toEqual({ value: false });
  });

  it("reports an uncached formula", () => {
    expect(normalizeCell(formulaCell(undefined), values)).toEqual({
      value: null,
      note: { kind: "formula", formula: "=SUM(A1:A2)", cached: false },
    });
  });

  it("returns the formula text in formulas mode", () => {
    expect(
      normalizeCell(formulaCell(7), { ...values, valueMode: "formulas" }),
    ).toEqual({ value: "=SUM(A1:A2)" });
  });

  it("returns both in both mode", () => {
    expect(
      normalizeCell(formulaCell(7), { ...values, valueMode: "both" }),
    ).toEqual({
      value: 7,
      note: { kind: "formula", formula: "=SUM(A1:A2)", cached: true },
    });
  });
});
