import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  FileSourceError,
  type ErrorFactory,
  type CoreErrorCode,
} from "../src/errors.js";
import { createFormatRegistry } from "../src/formats.js";
import { listSources } from "../src/listing.js";
import { coreLimits } from "../src/limits.js";

const listMode = { residentMaxBytes: coreLimits.maxFileBytes };
import {
  createSandboxRoot,
  isContained,
  resolveSourcePath,
  type SandboxEnvironment,
  type SandboxRoot,
} from "../src/paths.js";
import type { Vocabulary } from "../src/vocabulary.js";

const vocabulary: Vocabulary<string> = {
  serverName: "probe-mcp",
  subject: "document",
  rootLabel: "document root",
  readableLabel: "readable document",
  listTool: "list_documents",
  tooLargeRecovery: "Read a smaller file.",
};

const fail: ErrorFactory<CoreErrorCode> = (code, message, recovery) =>
  new FileSourceError(code, message, recovery);

const environment: SandboxEnvironment = {
  formats: createFormatRegistry({ ".probe": "probe" }, vocabulary, fail),
  vocabulary,
  fail,
  maxListScan: 5_000,
};

async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return (error as FileSourceError).code;
  }
  return "no-error";
}

describe("isContained", () => {
  it("accepts the root itself and anything under it", () => {
    expect(isContained("/base", "/base")).toBe(true);
    expect(isContained("/base", "/base/a/b.probe")).toBe(true);
  });

  it("rejects a sibling whose name shares the prefix", () => {
    expect(isContained("/base", "/basel/x.probe")).toBe(false);
  });

  it("rejects traversal and unrelated absolutes", () => {
    expect(isContained("/base", "/base/../x.probe")).toBe(false);
    expect(isContained("/base", "/other/x.probe")).toBe(false);
  });

  it("accepts an in-root file whose name begins with dots", () => {
    expect(isContained("/base", "/base/..archive.probe")).toBe(true);
  });
});

describe("the sandbox", () => {
  let root: SandboxRoot;
  let linkedRoot: SandboxRoot;
  let outsideDir: string;

  beforeAll(async () => {
    const parent = await mkdtemp(join(tmpdir(), "file-core-"));
    outsideDir = join(parent, "outside");
    const inside = join(parent, "inside");
    await mkdir(outsideDir);
    await mkdir(inside);
    await mkdir(join(inside, "nested"));
    await writeFile(join(inside, "a.probe"), "bytes");
    await writeFile(join(inside, "notes.txt"), "bytes");
    await writeFile(join(inside, "nested", "b.probe"), "bytes");
    await writeFile(join(outsideDir, "secret.probe"), "bytes");
    await symlink(
      join(outsideDir, "secret.probe"),
      join(inside, "escape.probe"),
    );
    await symlink(
      join(inside, "nested", "b.probe"),
      join(inside, "inward.probe"),
    );
    await symlink(join(parent, "nowhere.probe"), join(inside, "broken.probe"));
    await symlink(outsideDir, join(inside, "escape-dir"));
    await symlink(inside, join(parent, "linked-root"));
    root = await createSandboxRoot(inside, environment);
    linkedRoot = await createSandboxRoot(
      join(parent, "linked-root"),
      environment,
    );
  });

  describe("createSandboxRoot", () => {
    it("reports a missing root", async () => {
      expect(
        await codeOf(() =>
          createSandboxRoot(join(outsideDir, "nope"), environment),
        ),
      ).toBe("file_not_found");
    });

    it("reports a root that is a file", async () => {
      expect(
        await codeOf(() =>
          createSandboxRoot(join(outsideDir, "secret.probe"), environment),
        ),
      ).toBe("not_a_file");
    });

    it("stores the realpath of the root", () => {
      expect(root.real).toBe(resolve(root.real));
    });
  });

  describe("resolveSourcePath", () => {
    it("rejects an empty path and a NUL byte", async () => {
      expect(await codeOf(() => resolveSourcePath(root, ""))).toBe(
        "invalid_argument",
      );
      expect(await codeOf(() => resolveSourcePath(root, "a\0.probe"))).toBe(
        "invalid_argument",
      );
    });

    it("rejects an extension the registry does not carry", async () => {
      expect(await codeOf(() => resolveSourcePath(root, "notes.txt"))).toBe(
        "unsupported_extension",
      );
    });

    it("resolves a readable file under the root", async () => {
      await expect(resolveSourcePath(root, "a.probe")).resolves.toContain(
        "a.probe",
      );
    });

    it("rejects traversal", async () => {
      expect(
        await codeOf(() => resolveSourcePath(root, "../outside/secret.probe")),
      ).toBe("path_outside_root");
    });

    it("rejects an absolute path outside the root", async () => {
      expect(
        await codeOf(() =>
          resolveSourcePath(root, join(outsideDir, "secret.probe")),
        ),
      ).toBe("path_outside_root");
    });

    it("does not reveal whether a file outside the root exists", async () => {
      const existing = await codeOf(() =>
        resolveSourcePath(root, "../outside/secret.probe"),
      );
      const missing = await codeOf(() =>
        resolveSourcePath(root, "../outside/missing.probe"),
      );
      expect(existing).toBe("path_outside_root");
      expect(missing).toBe("path_outside_root");
    });

    it("rejects a symlink that escapes the root", async () => {
      expect(await codeOf(() => resolveSourcePath(root, "escape.probe"))).toBe(
        "path_outside_root",
      );
    });

    it("follows a symlink that stays inside the root", async () => {
      await expect(resolveSourcePath(root, "inward.probe")).resolves.toContain(
        "b.probe",
      );
    });

    it("reports a missing in-root file", async () => {
      expect(await codeOf(() => resolveSourcePath(root, "missing.probe"))).toBe(
        "file_not_found",
      );
    });

    it("names the list tool from the vocabulary", async () => {
      try {
        await resolveSourcePath(root, "missing.probe");
        expect.unreachable();
      } catch (error) {
        expect((error as FileSourceError).recovery).toContain("list_documents");
        expect((error as FileSourceError).message).toContain("document root");
      }
    });
  });

  describe("listSources", () => {
    it("lists only the extensions the registry carries", async () => {
      const listing = await listSources(root, {
        maxResults: 50,
        mode: listMode,
      });
      const names = listing.files.map((file) => file.filePath);
      expect(names).toContain("a.probe");
      expect(names).not.toContain("notes.txt");
    });

    it("lists an inward symlink and skips an escaping or broken one", async () => {
      const listing = await listSources(root, {
        maxResults: 50,
        mode: listMode,
      });
      const names = listing.files.map((file) => file.filePath);
      expect(names).toContain("inward.probe");
      expect(names).not.toContain("escape.probe");
      expect(names).not.toContain("broken.probe");
    });

    it("does not leak the names of files outside the root", async () => {
      const listing = await listSources(root, {
        maxResults: 50,
        mode: listMode,
      });
      expect(JSON.stringify(listing)).not.toContain("secret");
    });

    it("filters by pattern", async () => {
      const listing = await listSources(root, {
        pattern: "nested/*",
        maxResults: 50,
        mode: listMode,
      });
      expect(listing.files.map((file) => file.filePath)).toEqual([
        "nested/b.probe",
      ]);
    });

    it("truncates at maxResults and reports the true total", async () => {
      const listing = await listSources(root, {
        maxResults: 1,
        mode: listMode,
      });
      expect(listing.files).toHaveLength(1);
      expect(listing.total).toBeGreaterThan(1);
      expect(listing.truncated).toBe(true);
    });

    it("maps a missing subdirectory to file_not_found", async () => {
      expect(
        await codeOf(() =>
          listSources(root, {
            subdirectory: "nope",
            maxResults: 50,
            mode: listMode,
          }),
        ),
      ).toBe("file_not_found");
    });

    it("maps a file used as a subdirectory to not_a_file", async () => {
      expect(
        await codeOf(() =>
          listSources(root, {
            subdirectory: "a.probe",
            maxResults: 50,
            mode: listMode,
          }),
        ),
      ).toBe("not_a_file");
    });

    it("rejects a subdirectory that resolves outside the root", async () => {
      expect(
        await codeOf(() =>
          listSources(root, {
            subdirectory: "../outside",
            maxResults: 50,
            mode: listMode,
          }),
        ),
      ).toBe("path_outside_root");
    });

    it("keeps working when the root is itself a symlink", async () => {
      const direct = await listSources(root, {
        maxResults: 50,
        mode: listMode,
      });
      const linked = await listSources(linkedRoot, {
        maxResults: 50,
        mode: listMode,
      });
      expect(linked.files.map((file) => file.filePath)).toEqual(
        direct.files.map((file) => file.filePath),
      );
      expect(linked.files.length).toBeGreaterThan(0);
    });

    it("does not descend into a symlinked directory during a plain scan", async () => {
      const listing = await listSources(root, {
        maxResults: 50,
        mode: listMode,
      });
      const names = listing.files.map((file) => file.filePath);
      expect(names).toContain("a.probe");
      expect(names.some((path) => path.includes("secret"))).toBe(false);
      expect(names.some((path) => path.startsWith("escape-dir"))).toBe(false);
    });

    it("marks totals inexact when unsafe or unreadable entries were skipped", async () => {
      const listing = await listSources(root, {
        maxResults: 200,
        mode: listMode,
      });
      expect(listing.unreadable).toBeGreaterThan(0);
      expect(listing.totalExact).toBe(false);
    });

    it("returns a listed symlink path the resolver accepts", async () => {
      const listing = await listSources(root, {
        maxResults: 50,
        mode: listMode,
      });
      const linked = listing.files.find(
        (file) => file.filePath === "inward.probe",
      );
      expect(linked).toBeDefined();
      await expect(
        resolveSourcePath(root, linked?.filePath ?? ""),
      ).resolves.toContain("b.probe");
    });

    it("rejects a symlinked subdirectory that points outside the root", async () => {
      expect(
        await codeOf(() =>
          listSources(root, {
            subdirectory: "escape-dir",
            maxResults: 50,
            mode: listMode,
          }),
        ),
      ).toBe("path_outside_root");
    });
  });
});
