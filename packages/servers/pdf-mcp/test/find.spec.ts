import { beforeAll, describe, expect, inject, it } from "vitest";
import type { ToolHandlers } from "../src/tools/definitions.js";
import { bodyOf, codeOf, createHarness } from "./fixtures/harness.js";

let handlers: ToolHandlers;

beforeAll(async () => {
  const harness = await createHarness(inject("fixtures").root);
  handlers = harness.handlers;
});

interface FindBody {
  matches: { page: number; line: number; context: string }[];
  coverageComplete: boolean;
  unsearchablePages: number;
  searchedPages: number;
  pageCount: number;
  note?: string;
  nextCursor?: string;
  truncated: boolean;
}

const find = async (
  args: Parameters<ToolHandlers["find_in_document"]>[0],
): Promise<FindBody> =>
  bodyOf(await handlers.find_in_document(args)) as unknown as FindBody;

describe("literal matching", () => {
  it("finds text and reports a 1-based page", async () => {
    const body = await find({ filePath: "text.pdf", query: "2026-1188" });
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]?.page).toBe(2);
    expect(body.matches[0]?.context).toContain("2026-1188");
  });

  it("treats the query literally, not as a regular expression", async () => {
    const body = await find({ filePath: "text.pdf", query: "Invoice.*No" });
    expect(body.matches).toStrictEqual([]);
  });

  it("is case-sensitive by default and folds ASCII on request", async () => {
    const sensitive = await find({ filePath: "text.pdf", query: "invoice no" });
    expect(sensitive.matches).toStrictEqual([]);
    const folded = await find({
      filePath: "text.pdf",
      query: "invoice no",
      caseSensitive: false,
    });
    expect(folded.matches.length).toBeGreaterThan(0);
  });
});

describe("coverage honesty", () => {
  it("claims complete coverage only when every page was readable", async () => {
    const body = await find({ filePath: "text.pdf", query: "Customer" });
    expect(body.unsearchablePages).toBe(0);
    expect(body.coverageComplete).toBe(true);
    expect(body.note).toBeUndefined();
  });

  /**
   * The failure this guards: an agent reading an empty match list as proof the
   * document does not contain the text, when a third of it was never searched.
   */
  it("refuses to call an empty result complete when pages need OCR", async () => {
    const body = await find({ filePath: "mixed.pdf", query: "ZETA" });
    expect(body.matches).toStrictEqual([]);
    expect(body.unsearchablePages).toBe(1);
    expect(body.coverageComplete).toBe(false);
    expect(body.note).toContain("not proof");
  });

  it("still reports coverage when matches were found", async () => {
    const body = await find({ filePath: "mixed.pdf", query: "ALPHA" });
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]?.page).toBe(1);
    expect(body.coverageComplete).toBe(false);
    expect(body.unsearchablePages).toBe(1);
  });

  it("counts a fully scanned document as entirely unsearchable", async () => {
    const body = await find({ filePath: "scanned.pdf", query: "anything" });
    expect(body.searchedPages).toBe(0);
    expect(body.unsearchablePages).toBe(1);
    expect(body.coverageComplete).toBe(false);
  });
});

describe("paging", () => {
  it("walks every match exactly once across cursors", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 20; round += 1) {
      const body = await find({
        filePath: "many.pdf",
        query: "MARK",
        maxResults: 7,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const match of body.matches) {
        seen.push(`${String(match.page)}:${String(match.line)}`);
      }
      if (body.nextCursor === undefined) break;
      cursor = body.nextCursor;
    }
    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
  });

  it("refuses a cursor once the query changed", async () => {
    const first = await find({
      filePath: "many.pdf",
      query: "MARK",
      maxResults: 5,
    });
    expect(first.nextCursor).toBeDefined();
    expect(
      await codeOf(() =>
        handlers.find_in_document({
          filePath: "many.pdf",
          query: "MARK1",
          cursor: first.nextCursor ?? "",
        }),
      ),
    ).toBe("invalid_argument");
  });

  /**
   * Page size is not part of the cursor identity: the resume position is a
   * (page, ordinal) pair, so a caller may change how many matches it takes per
   * call without losing or repeating one.
   */
  it("allows the page size to change mid-walk", async () => {
    const first = await find({
      filePath: "many.pdf",
      query: "MARK",
      maxResults: 5,
    });
    const second = await find({
      filePath: "many.pdf",
      query: "MARK",
      maxResults: 9,
      cursor: first.nextCursor ?? "",
    });
    expect(second.matches.length).toBeGreaterThan(0);
    const overlap = second.matches.filter((match) =>
      first.matches.some(
        (seen) => seen.page === match.page && seen.line === match.line,
      ),
    );
    expect(overlap).toStrictEqual([]);
  });

  it("refuses a cursor minted by another tool", async () => {
    const read = bodyOf(
      await handlers.read_pages({ filePath: "many.pdf", maxPages: 1 }),
    );
    expect(
      await codeOf(() =>
        handlers.find_in_document({
          filePath: "many.pdf",
          query: "MARK",
          cursor: String(read["nextCursor"]),
        }),
      ),
    ).toBe("invalid_cursor");
  });

  it.each([["not-a-cursor"], [""], ["eyJ2IjoxfQ"]])(
    "refuses the forged cursor %s",
    async (cursor) => {
      expect(
        await codeOf(() =>
          handlers.find_in_document({
            filePath: "many.pdf",
            query: "MARK",
            cursor,
          }),
        ),
      ).toBe("invalid_cursor");
    },
  );
});
