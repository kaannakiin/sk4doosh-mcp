import { describe, expect, it } from "vitest";
import { normalizeCell, type NormalizeOptions } from "../src/cell-value.js";
import { xlsxSnapshot, type XlsxCell } from "../src/xlsx-cell.js";
import { limits } from "../src/limits.js";

const values: NormalizeOptions = {
  valueMode: "values",
  mergePolicy: "master",
  includeHyperlinks: false,
};

const snapshot = (value: unknown, extra: Record<string, unknown> = {}) =>
  xlsxSnapshot({ type: 3, value, ...extra } as unknown as XlsxCell);

describe("scalars", () => {
  it("keeps null and empty string apart", () => {
    expect(normalizeCell(snapshot(null), values).value).toBeNull();
    expect(normalizeCell(snapshot(undefined), values).value).toBeNull();
    expect(normalizeCell(snapshot(""), values).value).toBe("");
  });

  it("passes numbers and booleans through", () => {
    expect(normalizeCell(snapshot(0), values).value).toBe(0);
    expect(normalizeCell(snapshot(false), values).value).toBe(false);
  });

  it("renders a midnight date as a calendar day", () => {
    const cell = snapshot(new Date(Date.UTC(2026, 0, 15)), {
      numberFormat: "yyyy-mm-dd",
    });
    expect(normalizeCell(cell, values).value).toBe("2026-01-15");
  });

  it("renders a timed date as a full instant", () => {
    const cell = snapshot(new Date(Date.UTC(2026, 0, 15, 9, 30)), {
      numberFormat: "yyyy-mm-dd hh:mm",
    });
    expect(normalizeCell(cell, values).value).toBe("2026-01-15T09:30:00.000Z");
  });

  it("keeps the instant when the format carries a time token", () => {
    const cell = snapshot(new Date(Date.UTC(2026, 0, 15)), {
      numberFormat: "yyyy-mm-dd hh:mm",
    });
    expect(normalizeCell(cell, values).value).toBe("2026-01-15T00:00:00.000Z");
  });

  it("tags error cells", () => {
    expect(normalizeCell(snapshot({ error: "#DIV/0!" }), values).value).toEqual(
      {
        error: "#DIV/0!",
      },
    );
  });

  it("flattens rich text", () => {
    const cell = snapshot({ richText: [{ text: "a" }, { text: "b" }] });
    expect(normalizeCell(cell, values).value).toBe("ab");
  });

  it("returns hyperlink text and hides the href by default", () => {
    const cell = snapshot({ text: "Docs", hyperlink: "https://example.test" });
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
    const result = normalizeCell(snapshot(text), values);
    expect(String(result.value)).toHaveLength(limits.maxStringChars);
    expect(result.note).toEqual({ kind: "truncated", length: text.length });
  });
});

describe("merged cells", () => {
  it("blanks continuation cells under the master policy", () => {
    expect(
      normalizeCell(snapshot("merged", { type: 1 }), values).value,
    ).toBeNull();
  });

  it("repeats the master value when asked", () => {
    const result = normalizeCell(snapshot("merged", { type: 1 }), {
      ...values,
      mergePolicy: "repeat",
    });
    expect(result.value).toBe("merged");
  });
});

describe("formulas", () => {
  const formulaCell = (result: unknown) =>
    snapshot(
      { formula: "SUM(A1:A2)" },
      { type: 6, formula: "SUM(A1:A2)", result },
    );

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
    ).toEqual({
      value: "=SUM(A1:A2)",
    });
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
