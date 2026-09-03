import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SkMcpExcelError } from "../src/errors.js";
import {
  createWorkbookRoot,
  resolveWorkbookPath,
  type SandboxedPath,
} from "../src/paths.js";
import {
  describeWorkbook,
  requireBounds,
  selectWorksheet,
  usedBounds,
} from "../src/workbook.js";
import {
  clearDocumentCache,
  loadDocument,
  type LoadedWorkbook,
} from "../src/document.js";

async function codeOf(
  action: () => Promise<unknown> | unknown,
): Promise<string> {
  try {
    await action();
  } catch (error) {
    return (error as SkMcpExcelError).code;
  }
  return "no-error";
}

async function pathTo(file: string): Promise<SandboxedPath> {
  const fixtures = inject("fixtures");
  const root = await createWorkbookRoot(fixtures.root);
  return resolveWorkbookPath(root, file);
}

async function loadXlsx(path: SandboxedPath): Promise<LoadedWorkbook> {
  const loaded = await loadDocument(path);
  if (loaded.format !== "xlsx") {
    throw new Error("expected an xlsx fixture");
  }
  return loaded;
}

describe("describeWorkbook", () => {
  beforeAll(() => {
    clearDocumentCache();
  });

  it("reports the value-derived used range, not the declared one", async () => {
    const loaded = await loadXlsx(await pathTo("q1/sample.xlsx"));
    const description = describeWorkbook(
      loaded.workbook,
      {
        filePath: "q1/sample.xlsx",
        sizeBytes: loaded.sizeBytes,
        modifiedAt: loaded.modifiedAt,
      },
      true,
    );
    const sheet = description.sheets[0];
    expect(sheet?.name).toBe("Q1");
    expect(sheet?.usedRange).toBe("A1:F10");
    expect(sheet?.rowCount).toBe(10);
    expect(sheet?.declaredRowCount).toBe(5000);
  });

  it("counts formulas and their cached values apart", async () => {
    const loaded = await loadXlsx(await pathTo("q1/sample.xlsx"));
    const sheet = describeWorkbook(
      loaded.workbook,
      {
        filePath: "q1/sample.xlsx",
        sizeBytes: loaded.sizeBytes,
        modifiedAt: loaded.modifiedAt,
      },
      true,
    ).sheets[0];
    expect(sheet?.formulaCellCount).toBe(9);
    expect(sheet?.cachedFormulaValueCount).toBe(8);
  });

  it("reports merges, hidden sheets and the date system", async () => {
    const loaded = await loadXlsx(await pathTo("q1/sample.xlsx"));
    const description = describeWorkbook(
      loaded.workbook,
      {
        filePath: "q1/sample.xlsx",
        sizeBytes: loaded.sizeBytes,
        modifiedAt: loaded.modifiedAt,
      },
      true,
    );
    expect(description.dateSystem).toBe("1900");
    expect(description.sheets[0]?.mergeCount).toBe(1);
    expect(description.sheets[1]).toMatchObject({
      name: "Notes",
      state: "hidden",
      usedRange: null,
    });
  });

  it("emits guidance for a tall sheet", async () => {
    const loaded = await loadXlsx(await pathTo("large.xlsx"));
    const description = describeWorkbook(
      loaded.workbook,
      {
        filePath: "large.xlsx",
        sizeBytes: loaded.sizeBytes,
        modifiedAt: loaded.modifiedAt,
      },
      false,
    );
    expect(description.guidance).toMatch(/rows/);
    expect(description.definedNames).toBeUndefined();
  });
});

describe("worksheet selection", () => {
  it("defaults to the first visible sheet", async () => {
    const loaded = await loadXlsx(await pathTo("q1/sample.xlsx"));
    expect(selectWorksheet(loaded.workbook, undefined).name).toBe("Q1");
  });

  it("lists every sheet, hidden ones included, when the name is wrong", async () => {
    const loaded = await loadXlsx(await pathTo("q1/sample.xlsx"));
    try {
      selectWorksheet(loaded.workbook, "Nope");
      expect.unreachable();
    } catch (error) {
      const failure = error as SkMcpExcelError;
      expect(failure.code).toBe("unknown_sheet");
      expect(failure.recovery).toContain("Notes (hidden)");
    }
  });
});

describe("empty sheets", () => {
  it("has no used bounds", async () => {
    const loaded = await loadXlsx(await pathTo("empty.xlsx"));
    const worksheet = selectWorksheet(loaded.workbook, undefined);
    expect(usedBounds(worksheet)).toBeUndefined();
    expect(await codeOf(() => requireBounds(worksheet))).toBe("empty_sheet");
  });
});

describe("unreadable files", () => {
  it("rejects a file that is not a zip container", async () => {
    expect(
      await codeOf(async () => loadXlsx(await pathTo("corrupt.xlsx"))),
    ).toBe("corrupt_workbook");
  });

  it("rejects an encrypted or legacy container", async () => {
    expect(
      await codeOf(async () => loadXlsx(await pathTo("encrypted.xlsx"))),
    ).toBe("encrypted_workbook");
  });
});

describe("workbook cache", () => {
  it("returns the same instance for an unchanged file", async () => {
    clearDocumentCache();
    const path = await pathTo("q1/sample.xlsx");
    const first = await loadXlsx(path);
    const second = await loadXlsx(path);
    expect(second.workbook).toBe(first.workbook);
    expect(second.stamp).toBe(first.stamp);
  });
});
