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

  it("reports a missing subdirectory without blaming the workbook", async () => {
    const fixtures = inject("fixtures");
    const root = await createWorkbookRoot(fixtures.root);
    expect(
      await codeOf(() =>
        listWorkbooks(root, { subdirectory: "nope", maxResults: 5 }),
      ),
    ).toBe("file_not_found");
    try {
      await listWorkbooks(root, { subdirectory: "nope", maxResults: 5 });
    } catch (error) {
      const failure = error as SkMcpExcelError;
      expect(failure.message).toContain("nope");
      expect(failure.message).not.toContain(fixtures.root);
      expect(failure.recovery).toContain("list_workbooks");
    }
  });

  it("reports a file passed as a subdirectory", async () => {
    const fixtures = inject("fixtures");
    const root = await createWorkbookRoot(fixtures.root);
    expect(
      await codeOf(() =>
        listWorkbooks(root, {
          subdirectory: "q1/sample.xlsx",
          maxResults: 5,
        }),
      ),
    ).toBe("not_a_file");
  });

  it("does not report unreadable entries when nothing vanished", async () => {
    const fixtures = inject("fixtures");
    const root = await createWorkbookRoot(fixtures.root);
    const listing = await listWorkbooks(root, { maxResults: 200 });
    expect(listing.unreadable).toBeUndefined();
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

describe("listWorkbooks and symlinked subdirectories", () => {
  let root: WorkbookRoot;
  let linkedRoot: WorkbookRoot;

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "sk-list-"));
    const outside = `${base}-outside`;
    await mkdir(outside);
    await writeFile(join(outside, "secret.xlsx"), "PK");
    await mkdir(join(base, "root"));
    await mkdir(join(base, "root", "archive"));
    await writeFile(join(base, "root", "here.xlsx"), "PK");
    await writeFile(join(base, "root", "archive", "old.xlsx"), "PK");
    await symlink(outside, join(base, "root", "escape"));
    await symlink(join(base, "root", "archive"), join(base, "root", "inside"));
    await symlink(
      join(base, "root", "here.xlsx"),
      join(base, "root", "linked-inside.xlsx"),
    );
    await symlink(
      join(outside, "secret.xlsx"),
      join(base, "root", "linked-outside.xlsx"),
    );
    await symlink(
      join(base, "root", "gone.xlsx"),
      join(base, "root", "linked-broken.xlsx"),
    );
    root = await createWorkbookRoot(join(base, "root"));

    const real = await mkdtemp(join(tmpdir(), "sk-realroot-"));
    await writeFile(join(real, "data.xlsx"), "PK");
    await symlink(real, join(base, "rootlink"));
    linkedRoot = await createWorkbookRoot(join(base, "rootlink"));
  });

  it("refuses a subdirectory that symlinks out of the root", async () => {
    expect(
      await codeOf(() =>
        listWorkbooks(root, { subdirectory: "escape", maxResults: 10 }),
      ),
    ).toBe("path_outside_root");
  });

  it("does not leak the names of files outside the root", async () => {
    try {
      await listWorkbooks(root, { subdirectory: "escape", maxResults: 10 });
      expect.unreachable();
    } catch (error) {
      expect((error as SkMcpExcelError).message).not.toContain("secret");
    }
  });

  it("still follows a symlink that stays inside the root", async () => {
    const listing = await listWorkbooks(root, {
      subdirectory: "inside",
      maxResults: 10,
    });
    expect(listing.files.map((file) => file.filePath)).toEqual([
      "archive/old.xlsx",
    ]);
  });

  it("leaves a root that is itself a symlink working", async () => {
    const listing = await listWorkbooks(linkedRoot, { maxResults: 10 });
    expect(listing.files.map((file) => file.filePath)).toEqual(["data.xlsx"]);
  });

  it("does not descend into a symlinked directory during a plain scan", async () => {
    const listing = await listWorkbooks(root, { maxResults: 50 });
    const found = listing.files.map((file) => file.filePath);
    expect(found).toContain("here.xlsx");
    expect(found.some((path) => path.includes("secret"))).toBe(false);
  });
  it("lists a symlinked workbook that resolves inside the root", async () => {
    const listing = await listWorkbooks(root, { maxResults: 50 });
    expect(listing.files.map((file) => file.filePath)).toContain(
      "linked-inside.xlsx",
    );
  });

  it("does not list a symlinked workbook that resolves outside the root", async () => {
    const listing = await listWorkbooks(root, { maxResults: 50 });
    const found = listing.files.map((file) => file.filePath);
    expect(found).not.toContain("linked-outside.xlsx");
    expect(found.some((path) => path.includes("secret"))).toBe(false);
  });

  it("skips a broken symlink instead of failing the whole listing", async () => {
    const listing = await listWorkbooks(root, { maxResults: 50 });
    const found = listing.files.map((file) => file.filePath);
    expect(found).not.toContain("linked-broken.xlsx");
    expect(found).toContain("here.xlsx");
  });

  it("returns a symlink path the reader accepts", async () => {
    const listing = await listWorkbooks(root, { maxResults: 50 });
    const linked = listing.files.find(
      (file) => file.filePath === "linked-inside.xlsx",
    );
    expect(linked).toBeDefined();
    await expect(
      resolveWorkbookPath(root, linked?.filePath ?? ""),
    ).resolves.toContain("here.xlsx");
  });

  it("still refuses to read a symlink that escapes", async () => {
    expect(
      await codeOf(() => resolveWorkbookPath(root, "linked-outside.xlsx")),
    ).toBe("path_outside_root");
  });
});
