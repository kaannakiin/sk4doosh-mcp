import { describe, expect, inject, it } from "vitest";
import { loadDocument } from "../src/document.js";
import { createWorkbookRoot, resolveWorkbookPath } from "../src/paths.js";
import {
  findInSheet,
  readSheet,
  type ReadSheetOptions,
} from "../src/read-sheet.js";

const base: ReadSheetOptions = {
  maxCells: 2000,
  valueMode: "values",
  mergedCells: "master",
  headerRow: 1,
  includeHyperlinks: false,
};

async function open(file: string) {
  const fixtures = inject("fixtures");
  const root = await createWorkbookRoot(fixtures.root);
  return loadDocument(await resolveWorkbookPath(root, file));
}

describe("the grid layer cannot see the format", () => {
  it("returns the same columns and values for equivalent files", async () => {
    const xlsx = readSheet(await open("parity.xlsx"), base);
    const csv = readSheet(await open("csv/simple.csv"), base);

    expect(
      csv.columns.map((column) => [column.letter, column.index, column.header]),
    ).toEqual(
      xlsx.columns.map((column) => [
        column.letter,
        column.index,
        column.header,
      ]),
    );
    expect(csv.values).toEqual(xlsx.values);
    expect(csv.range).toBe(xlsx.range);
    expect(csv.usedRange).toBe(xlsx.usedRange);
    expect(csv.returnedRows).toBe(xlsx.returnedRows);
    expect(csv.returnedCells).toBe(xlsx.returnedCells);
    expect(csv.headerRow).toBe(xlsx.headerRow);
  });

  it("truncates and pages identically", async () => {
    const xlsx = readSheet(await open("parity.xlsx"), { ...base, maxCells: 5 });
    const csv = readSheet(await open("csv/simple.csv"), {
      ...base,
      maxCells: 5,
    });
    expect(csv.truncated).toBe(xlsx.truncated);
    expect(csv.truncationReason).toBe(xlsx.truncationReason);
    expect(csv.returnedRows).toBe(xlsx.returnedRows);
    expect(Boolean(csv.nextCursor)).toBe(Boolean(xlsx.nextCursor));
  });

  it("applies the same range resolution and clamping", async () => {
    const xlsx = readSheet(await open("parity.xlsx"), {
      ...base,
      range: "B2:C99",
    });
    const csv = readSheet(await open("csv/simple.csv"), {
      ...base,
      range: "B2:C99",
    });
    expect(csv.range).toBe(xlsx.range);
    expect(csv.values).toEqual(xlsx.values);
  });

  it("finds the same cells", async () => {
    const find = {
      query: "01234",
      matchMode: "contains" as const,
      caseSensitive: false,
      searchIn: "values" as const,
      maxResults: 50,
    };
    const xlsx = findInSheet(await open("parity.xlsx"), find);
    const csv = findInSheet(await open("csv/simple.csv"), find);
    expect(csv.matches).toEqual(xlsx.matches);
    expect(csv.matching).toBe(xlsx.matching);
  });
});
