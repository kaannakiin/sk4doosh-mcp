import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { SkMcpExcelError } from "../src/errors.js";
import { modePolicy } from "../src/limits.js";
import {
  createWorkbookRoot,
  listWorkbooks,
  resolveWorkbookPath,
  type WorkbookRoot,
} from "../src/paths.js";

async function failureOf(
  action: () => Promise<unknown>,
): Promise<SkMcpExcelError> {
  try {
    await action();
  } catch (error) {
    return error as SkMcpExcelError;
  }
  throw new Error("the call was expected to fail");
}

describe("the excel sandbox wiring", () => {
  let root: WorkbookRoot;

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "sk-wiring-"));
    await mkdir(join(base, "q"));
    await writeFile(join(base, "book.xlsx"), "PK");
    await writeFile(join(base, "macro.xlsm"), "PK");
    await writeFile(join(base, "rows.csv"), "a,b");
    await writeFile(join(base, "notes.txt"), "text");
    await writeFile(join(base, "q", "nested.xlsx"), "PK");
    root = await createWorkbookRoot(base);
  });

  it("resolves every extension the registry declares", async () => {
    await expect(resolveWorkbookPath(root, "book.xlsx")).resolves.toContain(
      "book.xlsx",
    );
    await expect(resolveWorkbookPath(root, "macro.xlsm")).resolves.toContain(
      "macro.xlsm",
    );
    await expect(resolveWorkbookPath(root, "rows.csv")).resolves.toContain(
      "rows.csv",
    );
  });

  it("refuses an extension the registry does not declare, and names them all", async () => {
    const failure = await failureOf(() =>
      resolveWorkbookPath(root, "notes.txt"),
    );
    expect(failure.code).toBe("unsupported_extension");
    expect(failure.message).toBe("'notes.txt' is not a readable spreadsheet.");
    expect(failure.recovery).toBe("Readable extensions: .xlsx, .xlsm, .csv.");
  });

  it("calls the sandbox root a workbook root", async () => {
    const failure = await failureOf(() =>
      resolveWorkbookPath(root, "../outside.xlsx"),
    );
    expect(failure.code).toBe("path_outside_root");
    expect(failure.message).toContain("workbook root");
    expect(failure.recovery).toContain("workbook root");
  });

  it("sends a lost reader to list_workbooks", async () => {
    const failure = await failureOf(() =>
      resolveWorkbookPath(root, "missing.xlsx"),
    );
    expect(failure.code).toBe("file_not_found");
    expect(failure.recovery).toContain("list_workbooks");
  });

  it("reports a missing subdirectory without leaking the root", async () => {
    const failure = await failureOf(() =>
      listWorkbooks(root, {
        subdirectory: "nope",
        maxResults: 50,
        mode: modePolicy,
      }),
    );
    expect(failure.code).toBe("file_not_found");
    expect(failure.message).toContain("nope");
    expect(failure.message).not.toContain(root.real);
    expect(failure.recovery).toContain("list_workbooks");
  });

  it("raises SkMcpExcelError, not the bare core error", async () => {
    const failure = await failureOf(() => resolveWorkbookPath(root, ""));
    expect(failure).toBeInstanceOf(SkMcpExcelError);
    expect(failure.name).toBe("SkMcpExcelError");
    expect(failure.code).toBe("invalid_argument");
  });

  it("lists both readable formats over the real fixture root", async () => {
    const fixtures = inject("fixtures");
    const listing = await listWorkbooks(
      await createWorkbookRoot(fixtures.root),
      {
        maxResults: 200,
        mode: modePolicy,
      },
    );
    const names = listing.files.map((file) => file.filePath);
    expect(names).toContain("q1/sample.xlsx");
    expect(names).toContain("csv/simple.csv");
    expect(
      listing.files.find((file) => file.filePath === "q1/sample.xlsx")
        ?.sizeBytes,
    ).toBeGreaterThan(0);
    expect(listing.truncated).toBe(false);
  });
});
