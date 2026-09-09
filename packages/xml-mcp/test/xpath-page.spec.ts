import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { encodePosition } from "../src/cursor.js";
import { limits } from "../src/limits.js";
import type { Fixtures } from "./fixtures/build.js";
import {
  bodyOf,
  bytesOf,
  createHarness,
  type Harness,
} from "./fixtures/harness.js";

let fixtures: Fixtures;
let harness: Harness;

type SelectArgs = Parameters<Harness["handlers"]["select_xpath"]>[0];

async function select(args: Record<string, unknown>) {
  const result = await harness.handlers.select_xpath(args as SelectArgs);
  return {
    isError: result.isError === true,
    body: bodyOf(result),
    bytes: bytesOf(result),
  };
}

function nodeIds(body: Record<string, unknown>): readonly string[] {
  return (body["members"] as readonly { readonly nodeId?: string }[]).map(
    (member) => member.nodeId ?? "",
  );
}

async function everyPage(
  args: Record<string, unknown>,
): Promise<{ readonly ids: readonly string[]; readonly pages: number }> {
  const ids: string[] = [];
  let cursor: unknown;
  let pages = 0;
  for (;;) {
    const outcome = await select(
      cursor === undefined ? args : { ...args, cursor },
    );
    expect(outcome.isError).toBe(false);
    ids.push(...nodeIds(outcome.body));
    pages += 1;
    cursor = outcome.body["nextCursor"];
    if (cursor === undefined || pages > 40) break;
  }
  return { ids, pages };
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("paging a node-set", () => {
  it("stops at maxResults and says so", async () => {
    const outcome = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      maxResults: 10,
    });
    expect(outcome.body["returnedCount"]).toBe(10);
    expect(outcome.body["totalMembers"]).toBe(300);
    expect(outcome.body["complete"]).toBe(false);
    expect(outcome.body["truncated"]).toBe(true);
    expect(outcome.body["truncationReason"]).toBe("maxResults");
    expect(outcome.body["nextCursor"]).toBeDefined();
  });

  it("joins the pages back into the whole node-set exactly once each", async () => {
    const walked = await everyPage({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      maxResults: 40,
    });
    expect(walked.ids).toHaveLength(300);
    expect(new Set(walked.ids).size).toBe(300);
    expect(walked.pages).toBe(8);
  });

  it("reports the last page as complete with no cursor", async () => {
    const outcome = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      maxResults: 200,
      cursor: undefined,
    });
    const second = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      maxResults: 200,
      cursor: outcome.body["nextCursor"],
    });
    expect(second.body["complete"]).toBe(true);
    expect(second.body["truncated"]).toBe(false);
    expect(second.body["nextCursor"]).toBeUndefined();
    expect(second.body["truncationReason"]).toBeUndefined();
  });

  it("cuts the page on the byte budget before maxResults and leaves a diagnosis", async () => {
    const outcome = await select({
      filePath: basename(fixtures.heavyQuery),
      xpath: "//cell/text()",
      maxResults: 200,
    });
    expect(outcome.isError).toBe(false);
    expect(outcome.bytes).toBeLessThanOrEqual(limits.maxPayloadBytes);
    expect(outcome.body["returnedCount"]).toBeLessThan(200);
    expect(outcome.body["truncationReason"]).toBe("maxPayloadBytes");
    expect(outcome.body["nextCursor"]).toBeDefined();
  });

  it("joins byte-cut pages into the whole node-set too", async () => {
    const walked = await everyPage({
      filePath: basename(fixtures.heavyQuery),
      xpath: "//cell/text()",
      maxResults: 200,
    });
    expect(walked.ids).toHaveLength(250);
    expect(new Set(walked.ids).size).toBe(250);
  });
});

describe("cursor binding", () => {
  it("refuses a cursor from another tool", async () => {
    const first = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      maxResults: 5,
    });
    const result = await harness.handlers.read_node({
      filePath: basename(fixtures.wideQuery),
      cursor: first.body["nextCursor"],
    } as Parameters<Harness["handlers"]["read_node"]>[0]);
    expect(result.isError).toBe(true);
    expect(bodyOf(result)["error"]).toBe("invalid_cursor");
  });

  it("refuses a cursor when the expression changed", async () => {
    const first = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      maxResults: 5,
    });
    const outcome = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//entry",
      maxResults: 5,
      cursor: first.body["nextCursor"],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
  });

  it("refuses a cursor when a namespace binding changed", async () => {
    const first = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      maxResults: 5,
    });
    const outcome = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      namespaces: [{ prefix: "a", uri: "urn:a" }],
      maxResults: 5,
      cursor: first.body["nextCursor"],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
  });

  it("refuses an expired cursor", async () => {
    const stale = encodePosition("0".repeat(64) as never, {
      t: "xpath",
      i: 3,
      o: "0".repeat(16),
      x: Date.now() - 1_000,
    });
    const outcome = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      cursor: stale,
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_cursor");
  });

  it("continues from a cursor whose worker no longer exists", async () => {
    const first = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      maxResults: 40,
    });
    expect(first.body["nextCursor"]).toBeDefined();

    const replacement = await createHarness(fixtures.root);
    try {
      const second = await replacement.handlers.select_xpath({
        filePath: basename(fixtures.wideQuery),
        xpath: "//name",
        maxResults: 40,
        cursor: first.body["nextCursor"],
      } as SelectArgs);
      const body = bodyOf(second);
      expect(second.isError).toBeUndefined();
      expect(body["offset"]).toBe(40);
      expect(body["returnedCount"]).toBe(40);
    } finally {
      await replacement.close();
    }
  });

  it("continues after the worker forgot the document and had to reparse it", async () => {
    const first = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      maxResults: 40,
    });
    await harness.pool.ask({ kind: "release" });
    const second = await select({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      maxResults: 40,
      cursor: first.body["nextCursor"],
    });
    expect(second.isError).toBe(false);
    expect(second.body["offset"]).toBe(40);
    expect(nodeIds(second.body)[0]).not.toBe(nodeIds(first.body)[0]);
  });
});
