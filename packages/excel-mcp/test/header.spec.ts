import { beforeAll, describe, expect, inject, it } from "vitest";
import { documentSheet, loadDocument } from "../src/document.js";
import type { SkMcpExcelError } from "../src/errors.js";
import {
  declaredHeaderRow,
  isHeaderCandidate,
  rowFacts,
  scanHeaderRow,
} from "../src/header.js";
import {
  createWorkbookRoot,
  resolveWorkbookPath,
  type WorkbookRoot,
} from "../src/paths.js";
import { resolveRange, type GridBounds } from "../src/range.js";
import type { SheetView } from "../src/sheet.js";
import { requireSheetBounds } from "../src/workbook.js";

describe("header row evidence", () => {
  let root: WorkbookRoot;

  beforeAll(async () => {
    root = await createWorkbookRoot(inject("fixtures").root);
  });

  const open = async (
    filePath: string,
    sheetName?: string,
  ): Promise<{ sheet: SheetView; bounds: GridBounds }> => {
    const loaded = await loadDocument(
      await resolveWorkbookPath(root, filePath),
    );
    const sheet = documentSheet(loaded, sheetName);
    return {
      sheet,
      bounds: resolveRange(requireSheetBounds(sheet), undefined),
    };
  };

  const codeOf = async (action: () => Promise<unknown>): Promise<string> => {
    try {
      await action();
    } catch (error) {
      return (error as SkMcpExcelError).code;
    }
    return "no-error";
  };

  it("does not count an empty string as naming or disqualifying", async () => {
    const { sheet, bounds } = await open("analysis.xlsx", "Sales");
    const facts = rowFacts(sheet, bounds, 1, "master");
    expect(facts.disqualifying).toBe(0);
    expect(isHeaderCandidate(facts)).toBe(true);
  });

  it("treats a merged title band as a non-candidate", async () => {
    const { sheet, bounds } = await open("title-band.xlsx", "Faturalar");
    expect(isHeaderCandidate(rowFacts(sheet, bounds, 1, "master"))).toBe(false);
    expect(isHeaderCandidate(rowFacts(sheet, bounds, 3, "master"))).toBe(true);
  });

  it("disqualifies a row that holds numbers", async () => {
    const { sheet, bounds } = await open("title-band.xlsx", "Faturalar");
    const facts = rowFacts(sheet, bounds, 4, "master");
    expect(facts.disqualifying).toBeGreaterThan(0);
    expect(isHeaderCandidate(facts)).toBe(false);
  });

  it("resolves the header row past a title band and a blank row", async () => {
    const { sheet, bounds } = await open("title-band.xlsx", "Faturalar");
    expect(scanHeaderRow(sheet, bounds, "master", "Faturalar")).toBe(3);
  });

  it.each([
    ["q1/sample.xlsx", undefined],
    ["wide.xlsx", undefined],
    ["large.xlsx", undefined],
    ["analysis.xlsx", "Sales"],
  ])("resolves row 1 for %s", async (filePath, sheetName) => {
    const { sheet, bounds } = await open(filePath, sheetName);
    expect(scanHeaderRow(sheet, bounds, "master", filePath)).toBe(1);
  });

  it("refuses to choose when two rows are both header rows", async () => {
    const { sheet, bounds } = await open("title-band.xlsx", "AllText");
    expect(
      await codeOf(async () =>
        scanHeaderRow(sheet, bounds, "master", "AllText"),
      ),
    ).toBe("ambiguous_header_row");
  });

  it("names the candidate rows so the agent can choose", async () => {
    const { sheet, bounds } = await open("title-band.xlsx", "AllText");
    try {
      scanHeaderRow(sheet, bounds, "master", "AllText");
      expect.unreachable();
    } catch (error) {
      const failure = error as SkMcpExcelError;
      expect(failure.recovery).toContain("Row 1");
      expect(failure.recovery).toContain("Row 2");
      expect(failure.recovery).toContain("headerRow 0 disables headers");
    }
  });

  it("refuses when no row is a header row", async () => {
    const { sheet, bounds } = await open("title-band.xlsx", "NoHeader");
    expect(
      await codeOf(async () =>
        scanHeaderRow(sheet, bounds, "master", "NoHeader"),
      ),
    ).toBe("unknown_header_row");
  });

  it("prefers a declared table over the text scan", async () => {
    const { sheet, bounds } = await open("title-band.xlsx", "Declared");
    const declared = declaredHeaderRow(sheet, bounds);
    expect(declared?.row).toBe(3);
    expect(declared?.source).toContain("Faturalar");
    expect(scanHeaderRow(sheet, bounds, "master", "Declared")).toBe(3);
  });

  it("finds no declaration on a sheet that carries none", async () => {
    const { sheet, bounds } = await open("title-band.xlsx", "Faturalar");
    expect(declaredHeaderRow(sheet, bounds)).toBeUndefined();
  });
});
