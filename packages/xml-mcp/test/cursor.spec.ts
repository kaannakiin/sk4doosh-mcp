import { readFile, stat, utimes, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { encodePosition } from "../src/cursor.js";
import type { Fixtures } from "./fixtures/build.js";
import { bodyOf, createHarness, type Harness } from "./fixtures/harness.js";

let fixtures: Fixtures;
let harness: Harness;

async function read(args: Record<string, unknown>) {
  const result = await harness.handlers.read_node(
    args as Parameters<Harness["handlers"]["read_node"]>[0],
  );
  return { isError: result.isError === true, body: bodyOf(result) };
}

async function find(args: Record<string, unknown>) {
  const result = await harness.handlers.find_in_document(
    args as Parameters<Harness["handlers"]["find_in_document"]>[0],
  );
  return { isError: result.isError === true, body: bodyOf(result) };
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("cursor validation", () => {
  it("refuses a token it did not produce", async () => {
    const outcome = await read({
      filePath: basename(fixtures.wide),
      cursor: "not-a-cursor",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_cursor");
  });

  it("refuses a read cursor handed to the search tool", async () => {
    const first = await read({ filePath: basename(fixtures.wide), maxNodes: 3 });
    const outcome = await find({
      filePath: basename(fixtures.wide),
      query: "v1",
      cursor: first.body["nextCursor"],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_cursor");
  });

  it("refuses an expired cursor", async () => {
    const stale = encodePosition(
      "0".repeat(64) as never,
      { t: "read", p: [1, 1], s: [1], o: "0".repeat(16), x: Date.now() - 1_000 },
    );
    const outcome = await read({
      filePath: basename(fixtures.wide),
      cursor: stale,
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_cursor");
  });

  it("refuses a cursor combined with an address", async () => {
    const first = await read({ filePath: basename(fixtures.wide), maxNodes: 3 });
    const outcome = await read({
      filePath: basename(fixtures.wide),
      maxNodes: 3,
      cursor: first.body["nextCursor"],
      address: [{ namespaceUri: "", localName: "w" }],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
  });

  it("refuses options that differ from the ones the cursor carries", async () => {
    const first = await read({ filePath: basename(fixtures.wide), maxNodes: 3 });
    const outcome = await read({
      filePath: basename(fixtures.wide),
      maxNodes: 9,
      cursor: first.body["nextCursor"],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
    expect(String(outcome.body["message"])).toContain("options");
  });

  it("never restores a changed option silently from the cursor", async () => {
    const first = await read({ filePath: basename(fixtures.wide), maxNodes: 3 });
    const same = await read({
      filePath: basename(fixtures.wide),
      maxNodes: 3,
      cursor: first.body["nextCursor"],
    });
    expect(same.isError).toBe(false);
    expect(same.body["returnedCount"]).toBe(3);
  });
});

describe("snapshot freshness", () => {
  it("rejects a cursor after a same-size edit with the mtime put back", async () => {
    const path = join(fixtures.root, "swap.xml");
    await writeFile(path, "<w><i>aaa</i><i>bbb</i><i>ccc</i></w>\n", "utf8");
    const before = await stat(path);

    const first = await read({ filePath: "swap.xml", maxNodes: 2 });
    expect(first.isError).toBe(false);
    expect(first.body["nextCursor"]).toBeDefined();

    const original = await readFile(path, "utf8");
    const edited = original.replace("bbb", "zzz");
    expect(edited).toHaveLength(original.length);
    await writeFile(path, edited, "utf8");
    await utimes(path, before.atime, before.mtime);

    const outcome = await read({
      filePath: "swap.xml",
      maxNodes: 2,
      cursor: first.body["nextCursor"],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("stale_cursor");
  });
});
