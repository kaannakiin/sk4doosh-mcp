import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fail, LiaisoLlmError } from "../src/platform/errors.js";
import { openWorkspace, type Workspace } from "../src/platform/workspace.js";

let base: string;
let workspace: Workspace;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "llm-mcp-ws-")));
  const root = join(base, "root");
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs", "note.txt"), "merhaba");
  await writeFile(join(root, "bom.txt"), "﻿başlık");
  await writeFile(join(root, "nul.bin"), Buffer.from([0x61, 0x00, 0x62]));
  await writeFile(join(root, "latin1.txt"), Buffer.from([0x67, 0xfc, 0x6c]));
  await writeFile(join(root, "big.txt"), "x".repeat(2_000));
  await writeFile(join(base, "secret.txt"), "outside");
  await symlink(join(base, "secret.txt"), join(root, "escape.txt"));
  workspace = await openWorkspace(root, fail);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  const error: unknown = await work.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(LiaisoLlmError);
  return (error as LiaisoLlmError).code;
};

describe("resolve", () => {
  it("accepts a path relative to the workspace", async () => {
    const path = await workspace.resolve("docs/note.txt");
    expect(await workspace.readText(path, 1_000)).toBe("merhaba");
  });

  it.each(["../secret.txt", "docs/../../secret.txt"])(
    "refuses %s as outside the workspace",
    async (requested) => {
      expect(await codeOf(workspace.resolve(requested))).toBe(
        "outside_workspace",
      );
    },
  );

  it("refuses an absolute path outside the workspace", async () => {
    expect(await codeOf(workspace.resolve(join(base, "secret.txt")))).toBe(
      "outside_workspace",
    );
  });

  it("refuses a symlink that points outside the workspace", async () => {
    expect(await codeOf(workspace.resolve("escape.txt"))).toBe(
      "outside_workspace",
    );
  });

  it("reports a missing file and a directory the same way", async () => {
    expect(await codeOf(workspace.resolve("docs/missing.txt"))).toBe(
      "file_not_found",
    );
    expect(await codeOf(workspace.resolve("docs"))).toBe("file_not_found");
  });

  it("refuses an empty path and a NUL byte", async () => {
    expect(await codeOf(workspace.resolve(""))).toBe("invalid_argument");
    expect(await codeOf(workspace.resolve("a\0b"))).toBe("invalid_argument");
  });
});

describe("readText", () => {
  it("drops a byte order mark", async () => {
    const path = await workspace.resolve("bom.txt");
    expect(await workspace.readText(path, 1_000)).toBe("başlık");
  });

  it.each(["nul.bin", "latin1.txt"])("refuses %s as not text", async (name) => {
    const path = await workspace.resolve(name);
    expect(await codeOf(workspace.readText(path, 1_000))).toBe("not_text");
  });

  it("refuses a file over the byte ceiling before reading it", async () => {
    const path = await workspace.resolve("big.txt");
    expect(await codeOf(workspace.readText(path, 1_999))).toBe(
      "input_too_large",
    );
  });
});

describe("redact", () => {
  it("replaces the workspace root with a dot", () => {
    expect(workspace.redact(`${workspace.root}/docs/note.txt`)).toBe(
      "./docs/note.txt",
    );
  });
});

describe("createOutput", () => {
  it("adds a file under the output directory and returns its relative path", async () => {
    const path = await workspace.createOutput("report", "a,b\n");
    expect(path).toBe(".llm-mcp/out/report.csv");
    expect(await readFile(join(workspace.root, path), "utf8")).toBe("a,b\n");
  });

  it("never replaces an existing file", async () => {
    const first = await workspace.createOutput("same", "one");
    const second = await workspace.createOutput("same", "two");
    expect(second).not.toBe(first);
    expect(await readFile(join(workspace.root, first), "utf8")).toBe("one");
  });

  it.each(["../../escape", "AGENTS.md", "/etc/passwd", ".hidden"])(
    "keeps the name %s inside the output directory with a csv extension",
    async (name) => {
      const path = await workspace.createOutput(name, "x");
      expect(path.startsWith(".llm-mcp/out/")).toBe(true);
      expect(path.endsWith(".csv")).toBe(true);
      expect(path.slice(".llm-mcp/out/".length)).not.toContain("/");
    },
  );

  it("refuses an output directory outside the workspace", async () => {
    expect(
      await codeOf(openWorkspace(workspace.root, fail, "../elsewhere")),
    ).toBe("outside_workspace");
  });

  it("refuses an output directory that is a symlink to outside", async () => {
    const root = join(base, "linked");
    await mkdir(root);
    await symlink(base, join(root, "out"));
    const linked = await openWorkspace(root, fail, "out");
    expect(await codeOf(linked.createOutput("x", "y"))).toBe(
      "outside_workspace",
    );
  });
});
