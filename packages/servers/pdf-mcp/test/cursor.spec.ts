import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { ToolHandlers } from "../src/tools/definitions.js";
import { bodyOf, codeOf, createHarness } from "./fixtures/harness.js";
import { createDocumentRoot } from "../src/platform/paths.js";
import { createHandlers } from "../src/tools/handlers.js";
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

  it("gives a selection that fits one response no cursor", async () => {
    const body = bodyOf(
      await handlers.read_pages({ filePath: "many.pdf", pages: [1, 2] }),
    );
    expect(body["nextCursor"]).toBeUndefined();
  });

  it("resumes an explicit selection without reaching other pages", async () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 10; round += 1) {
      const body = bodyOf(
        await handlers.read_pages({
          filePath: "many.pdf",
          maxPages: 2,
          ...(cursor === undefined ? { pages: [5, 9, 2, 7, 30] } : { cursor }),
        }),
      );
      for (const page of body["pages"] as { page: number }[]) {
        seen.push(page.page);
      }
      const next = body["nextCursor"];
      if (next === undefined) break;
      cursor = String(next);
    }
    expect(seen).toStrictEqual([5, 9, 2, 7, 30]);
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

describe("a page larger than one response", () => {
  /**
   * The failure this guards: a page that does not fit was clamped and the cursor
   * then advanced to the *next* page, so the clipped tail was unreachable by any
   * call. Re-requesting the page returned the same prefix forever.
   */
  it("hands back every part of the page across continuations", async () => {
    const root = await createDocumentRoot(inject("fixtures").root);
    const whole = (
      bodyOf(
        await createHandlers(root).read_pages({
          filePath: "long.pdf",
          pages: [1],
        }),
      )["pages"] as { markdown: string }[]
    )[0]?.markdown;
    expect(whole?.length).toBeGreaterThan(400);

    const handlers = createHandlers(root, { maxPayloadBytes: 800 });
    const parts: string[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 40; round += 1) {
      const body = bodyOf(
        await handlers.read_pages({
          filePath: "long.pdf",
          maxPages: 1,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      const pages = body["pages"] as { page: number; markdown: string }[];
      const first = pages[0];
      if (first === undefined || first.page !== 1) break;
      parts.push(first.markdown);
      const next = body["nextCursor"];
      if (next === undefined) break;
      cursor = String(next);
    }
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(whole);
  });
});

describe("a selected page larger than one response", () => {
  it("hands back every part of an explicitly selected page", async () => {
    const root = await createDocumentRoot(inject("fixtures").root);
    const whole = (
      bodyOf(
        await createHandlers(root).read_pages({
          filePath: "long.pdf",
          pages: [1],
        }),
      )["pages"] as { markdown: string }[]
    )[0]?.markdown;

    const handlers = createHandlers(root, { maxPayloadBytes: 800 });
    const parts: string[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 40; round += 1) {
      const body = bodyOf(
        await handlers.read_pages({
          filePath: "long.pdf",
          ...(cursor === undefined ? { pages: [1] } : { cursor }),
        }),
      );
      for (const page of body["pages"] as {
        page: number;
        markdown: string;
      }[]) {
        expect(page.page).toBe(1);
        parts.push(page.markdown);
      }
      const next = body["nextCursor"];
      if (next === undefined) break;
      cursor = String(next);
    }
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(whole);
  });
});
