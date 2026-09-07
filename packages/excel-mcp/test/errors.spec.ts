import { beforeAll, describe, expect, inject, it } from "vitest";
import { loadDocument } from "../src/document.js";
import {
  asExcelError,
  type SkMcpExcelError,
  SkMcpExcelError as ExcelError,
} from "../src/errors.js";
import {
  createWorkbookRoot,
  resolveWorkbookPath,
  type WorkbookRoot,
} from "../src/paths.js";

describe("asExcelError", () => {
  it("passes a SkMcpExcelError through untouched", () => {
    const original = new ExcelError("unknown_sheet", "no such sheet", "look");
    expect(asExcelError(original)).toBe(original);
  });

  it("maps an unclassified throw to internal_error, not corrupt_workbook", () => {
    const mapped = asExcelError(new TypeError("x is not a function"));
    expect(mapped.code).toBe("internal_error");
    expect(mapped.message).toContain("x is not a function");
  });

  it("does not offer workbook recovery advice for an internal failure", () => {
    const mapped = asExcelError(new TypeError("boom"));
    expect(mapped.recovery).not.toContain("re-save");
    expect(mapped.recovery).toContain("excel-mcp server");
  });

  it("names the tool when one is given", () => {
    const mapped = asExcelError(new Error("boom"), { tool: "list_workbooks" });
    expect(mapped.message).toContain("list_workbooks");
  });

  it("strips the sandbox root from the detail", () => {
    const mapped = asExcelError(
      new Error("ENOENT: no such file or directory, scandir '/data/sheets/q1'"),
      { root: "/data/sheets" },
    );
    expect(mapped.message).not.toContain("/data/sheets");
    expect(mapped.message).toContain("q1");
  });

  it("accepts a throw that is not an Error", () => {
    expect(asExcelError("boom").code).toBe("internal_error");
  });
});

describe("a workbook that passes the magic-byte gate but cannot be parsed", () => {
  let root: WorkbookRoot;

  beforeAll(async () => {
    root = await createWorkbookRoot(inject("fixtures").root);
  });

  const codeOf = async (filePath: string): Promise<string> => {
    try {
      await loadDocument(await resolveWorkbookPath(root, filePath));
    } catch (error) {
      return (error as SkMcpExcelError).code;
    }
    return "no-error";
  };

  it.each([["truncated.xlsx"], ["flipped.xlsx"]])(
    "reports %s as corrupt_workbook",
    async (filePath) => {
      expect(await codeOf(filePath)).toBe("corrupt_workbook");
    },
  );

  it("reports a zip that carries no workbook part", async () => {
    expect(await codeOf("not-a-workbook.xlsx")).toBe("corrupt_workbook");
  });

  it("blames the file, not the server, for a zip that is not a workbook", async () => {
    try {
      await loadDocument(
        await resolveWorkbookPath(root, "not-a-workbook.xlsx"),
      );
      expect.unreachable();
    } catch (error) {
      const failure = error as SkMcpExcelError;
      expect(failure.code).not.toBe("internal_error");
      expect(failure.code).not.toBe("unknown_sheet");
      expect(failure.recovery).toContain("not a spreadsheet");
    }
  });

  it("still reads a healthy workbook", async () => {
    expect(await codeOf("q1/sample.xlsx")).toBe("no-error");
  });
});
