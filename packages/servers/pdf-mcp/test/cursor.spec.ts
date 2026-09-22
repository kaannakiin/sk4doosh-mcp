import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { ToolHandlers } from "../src/tools/definitions.js";
import { bodyOf, codeOf, createHarness } from "./fixtures/harness.js";
import { textPdf } from "./fixtures/pdf.js";

let handlers: ToolHandlers;

beforeAll(async () => {
  const harness = await createHarness(inject("fixtures").root);
  handlers = harness.handlers;
});

describe("read_pages paging", () => {
  it("delivers every page exactly once across cursors", async () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 30; round += 1) {
      const body = bodyOf(
        await handlers.read_pages({
          filePath: "many.pdf",
          maxPages: 6,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      for (const page of body["pages"] as { page: number }[]) {
        seen.push(page.page);
      }
      const next = body["nextCursor"];
      if (next === undefined) break;
      cursor = String(next);
    }
    expect(seen).toStrictEqual(
      Array.from({ length: 40 }, (_unused, index) => index + 1),
    );
  });

  it("gives an explicit selection no cursor to resume from", async () => {
    const body = bodyOf(
      await handlers.read_pages({ filePath: "many.pdf", pages: [1, 2] }),
    );
    expect(body["nextCursor"]).toBeUndefined();
  });

  it("refuses a cursor once the document changed", async () => {
    const root = inject("fixtures").root;
    const name = "volatile.pdf";
    await writeFile(join(root, name), textPdf([["one"], ["two"], ["three"]]));
    const first = bodyOf(
      await handlers.read_pages({ filePath: name, maxPages: 1 }),
    );
    const cursor = String(first["nextCursor"]);
    await writeFile(
      join(root, name),
      textPdf([["one changed"], ["two"], ["three"]]),
    );
    expect(
      await codeOf(() => handlers.read_pages({ filePath: name, cursor })),
    ).toBe("stale_cursor");
  });
});

describe("oversized content", () => {
  it("clamps a page that cannot fit and says so", async () => {
    const root = inject("fixtures").root;
    const name = "huge.pdf";
    const line = `HUGE ${"y".repeat(4000)}`;
    await writeFile(
      join(root, name),
      textPdf([Array.from({ length: 400 }, () => line), ["second"]]),
    );
    const body = bodyOf(await handlers.read_pages({ filePath: name }));
    const pages = body["pages"] as {
      page: number;
      truncatedMarkdown?: boolean;
    }[];
    expect(pages.length).toBeGreaterThan(0);
    if (pages[0]?.truncatedMarkdown === true) {
      expect(body["truncated"]).toBe(true);
      expect(body["truncationReason"]).toBe("maxPayloadBytes");
    }
  });
});
