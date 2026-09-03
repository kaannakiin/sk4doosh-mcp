import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, inject } from "vitest";
import type { SkMcpExcelError } from "../src/errors.js";
import {
  createWorkbookRoot,
  isContained,
  listWorkbooks,
  resolveWorkbookPath,
  type WorkbookRoot,
} from "../src/paths.js";

async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return (error as SkMcpExcelError).code;
  }
  return "no-error";
}

describe("isContained", () => {
  it("accepts descendants and the root itself", () => {
    expect(isContained("/base", "/base")).toBe(true);
    expect(isContained("/base", "/base/a.xlsx")).toBe(true);
    expect(isContained("/base", "/base/sub/a.xlsx")).toBe(true);
  });

  it("rejects a sibling directory that shares the prefix", () => {
    expect(isContained("/base", "/base-evil/a.xlsx")).toBe(false);
    expect(isContained("/base", "/basel/a.xlsx")).toBe(false);
  });

  it("rejects ancestors and unrelated paths", () => {
    expect(isContained("/base", "/")).toBe(false);
    expect(isContained("/base", "/etc/passwd")).toBe(false);
  });
});

describe("resolveWorkbookPath", () => {
  let root: WorkbookRoot;
  let sibling: string;

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "sk-paths-"));
    sibling = `${base}-evil`;
    await mkdir(sibling);
    await mkdir(join(base, "sub"));
    await writeFile(join(sibling, "outside.xlsx"), "PK");
    await writeFile(join(base, "ok.xlsx"), "PK");
    await writeFile(join(base, "..archive.xlsx"), "PK");
    await writeFile(join(base, "sub", "nested.xlsx"), "PK");
    await writeFile(join(base, "notes.txt"), "text");
    await writeFile(join(base, "report.xlsx.sh"), "text");
    await symlink(join(sibling, "outside.xlsx"), join(base, "escape.xlsx"));
    await symlink(join(base, "ok.xlsx"), join(base, "inside.xlsx"));
    root = await createWorkbookRoot(base);
  });

  it("accepts files under the root", async () => {
    await expect(resolveWorkbookPath(root, "ok.xlsx")).resolves.toContain(
      "ok.xlsx",
    );
    await expect(
      resolveWorkbookPath(root, "sub/nested.xlsx"),
    ).resolves.toContain("nested.xlsx");
  });

  it("accepts a leading-dots file name", async () => {
    await expect(
      resolveWorkbookPath(root, "..archive.xlsx"),
    ).resolves.toContain("..archive");
  });

  it("follows a symlink that stays inside", async () => {
    await expect(resolveWorkbookPath(root, "inside.xlsx")).resolves.toContain(
      "ok.xlsx",
    );
  });

  it("rejects traversal", async () => {
    expect(
      await codeOf(() => resolveWorkbookPath(root, "../outside.xlsx")),
    ).toBe("path_outside_root");
    expect(
      await codeOf(() => resolveWorkbookPath(root, "../../etc/passwd.xlsx")),
    ).toBe("path_outside_root");
  });

  it("rejects an absolute path outside the root", async () => {
    expect(
      await codeOf(() =>
        resolveWorkbookPath(root, join(sibling, "outside.xlsx")),
      ),
    ).toBe("path_outside_root");
  });

  it("rejects a symlink that escapes", async () => {
    expect(await codeOf(() => resolveWorkbookPath(root, "escape.xlsx"))).toBe(
      "path_outside_root",
    );
  });

  it("does not reveal whether a file outside the root exists", async () => {
    expect(
      await codeOf(() => resolveWorkbookPath(root, "../missing.xlsx")),
    ).toBe("path_outside_root");
  });

  it("rejects unreadable extensions", async () => {
    expect(await codeOf(() => resolveWorkbookPath(root, "notes.txt"))).toBe(
      "unsupported_extension",
    );
    expect(
      await codeOf(() => resolveWorkbookPath(root, "report.xlsx.sh")),
    ).toBe("unsupported_extension");
  });

  it("rejects empty and NUL-bearing paths", async () => {
    expect(await codeOf(() => resolveWorkbookPath(root, ""))).toBe(
      "invalid_argument",
    );
    expect(await codeOf(() => resolveWorkbookPath(root, "a\0b.xlsx"))).toBe(
      "invalid_argument",
    );
  });

  it("reports a missing file inside the root", async () => {
    expect(await codeOf(() => resolveWorkbookPath(root, "missing.xlsx"))).toBe(
      "file_not_found",
    );
  });
});

describe("listWorkbooks", () => {
  it("lists spreadsheets under the fixture root", async () => {
    const fixtures = inject("fixtures");
    const root = await createWorkbookRoot(fixtures.root);
    const listing = await listWorkbooks(root, { maxResults: 50 });
    expect(listing.files.map((file) => file.filePath)).toContain(
      "q1/sample.xlsx",
    );
    expect(listing.truncated).toBe(false);
    const sample = listing.files.find(
      (file) => file.filePath === "q1/sample.xlsx",
    );
    expect(sample?.sizeBytes).toBeGreaterThan(0);
    expect(listing.files.map((file) => file.filePath)).toContain(
      "csv/simple.csv",
    );
  });

  it("filters by glob and subdirectory", async () => {
    const fixtures = inject("fixtures");
    const root = await createWorkbookRoot(fixtures.root);
    const listing = await listWorkbooks(root, {
      pattern: "q1/*.xlsx",
      maxResults: 50,
    });
    expect(listing.files.map((file) => file.filePath)).toEqual([
      "q1/sample.xlsx",
    ]);

    const nested = await listWorkbooks(root, {
      subdirectory: "q1",
      maxResults: 50,
    });
    expect(nested.files.map((file) => file.filePath)).toEqual([
      "q1/sample.xlsx",
    ]);
  });

  it("truncates at maxResults", async () => {
    const fixtures = inject("fixtures");
    const root = await createWorkbookRoot(fixtures.root);
    const listing = await listWorkbooks(root, { maxResults: 1 });
    expect(listing.files).toHaveLength(1);
    expect(listing.truncated).toBe(true);
    expect(listing.total).toBeGreaterThan(1);
  });

  it("rejects a subdirectory outside the root", async () => {
    const fixtures = inject("fixtures");
    const root = await createWorkbookRoot(fixtures.root);
    expect(
      await codeOf(() =>
        listWorkbooks(root, { subdirectory: "..", maxResults: 5 }),
      ),
    ).toBe("path_outside_root");
  });
});
