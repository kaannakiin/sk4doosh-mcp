import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, inject, it } from "vitest";
import { classify, extractAll } from "../src/engine/inspector.js";
import {
  assertSelectablePages,
  assertWithinPageBudget,
} from "../src/engine/pages.js";
import { limits } from "../src/platform/limits.js";
import { LiaisoPdfError } from "../src/platform/errors.js";
import { pdfWithPages, textPdf } from "./fixtures/pdf.js";

const bytesOf = async (name: string): Promise<Buffer> =>
  readFile(join(inject("fixtures").root, name));

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof LiaisoPdfError) return error.code;
    throw error;
  }
  throw new Error("Expected a LiaisoPdfError.");
};

describe("page numbering", () => {
  it("reports the first page as 1, never 0", async () => {
    const extracted = await extractAll(await bytesOf("text.pdf"), "text.pdf");
    expect(extracted.pages.map((page) => page.page)).toStrictEqual([1, 2, 3]);
    expect(extracted.pages[0]?.markdown).toContain("2026-0917");
  });

  /**
   * The library answers a 0-based `page` alongside a 1-based `pagesNeedingOcr`
   * in one and the same result. This pins that both reach us as 1-based and
   * agree on which page is meant.
   */
  it("aligns the per-page index with the OCR page list", async () => {
    const extracted = await extractAll(await bytesOf("mixed.pdf"), "mixed.pdf");
    const flagged = extracted.pages
      .filter((page) => page.needsOcr)
      .map((page) => page.page);
    expect(flagged).toStrictEqual([2]);
    expect(extracted.pagesNeedingOcr).toStrictEqual([2]);
    expect(extracted.pages[1]?.markdown.trim()).toBe("");
    expect(extracted.pages[0]?.markdown).toContain("ALPHA");
    expect(extracted.pages[2]?.markdown).toContain("OMEGA");
  });
});

describe("classification is a document verdict, not a page list", () => {
  /**
   * Measured on 1.23.0: the classifier flags every page of a
   * document that contains a single scanned page. describe_document must not
   * build its page list from it, and this test fails if we ever start.
   */
  it("classifies a mixed document as image-based while only one page is scanned", async () => {
    const bytes = await bytesOf("mixed.pdf");
    const classified = await classify(bytes, "mixed.pdf");
    const extracted = await extractAll(bytes, "mixed.pdf");
    expect(classified.pageCount).toBe(3);
    expect(classified.documentType).toBe("image_based");
    expect(extracted.pagesNeedingOcr).toStrictEqual([2]);
  });

  it("scores confidence on its own verdict, not on text accuracy", async () => {
    const classified = await classify(await bytesOf("text.pdf"), "text.pdf");
    expect(classified.documentType).toBe("text_based");
    expect(classified.classificationConfidence).toBeGreaterThan(0);
    expect(classified.classificationConfidence).toBeLessThanOrEqual(1);
  });
});

describe("failure classification", () => {
  it.each([
    ["empty.pdf", "malformed_pdf"],
    ["truncated.pdf", "malformed_pdf"],
    ["garbage.pdf", "malformed_pdf"],
    ["encrypted.pdf", "encrypted_pdf"],
  ])("maps %s to %s", async (name, expected) => {
    const bytes = await bytesOf(name);
    expect(await codeOf(() => classify(bytes, name))).toBe(expected);
    expect(await codeOf(() => extractAll(bytes, name))).toBe(expected);
  });

  it("never leaks the engine's internal function name", async () => {
    const bytes = await bytesOf("encrypted.pdf");
    try {
      await extractAll(bytes, "encrypted.pdf");
      throw new Error("Expected a refusal.");
    } catch (error) {
      expect(error).toBeInstanceOf(LiaisoPdfError);
      expect((error as LiaisoPdfError).message).not.toContain(
        "extract_pages_markdown",
      );
    }
  });
});

describe("page selection is validated before the engine sees it", () => {
  /**
   * The library answers an out-of-range index with a phantom page whose
   * needsOcr is true, and wraps a negative one through u32. Neither may reach an
   * agent as a real page.
   */
  it.each([[0], [-1], [4]])("refuses page %i on a 3 page document", (page) => {
    expect(() => {
      assertSelectablePages([page], 3);
    }).toThrow(LiaisoPdfError);
  });

  it("accepts every page in range", () => {
    expect(() => {
      assertSelectablePages([1, 3], 3);
    }).not.toThrow();
  });

  it("refuses an empty selection", () => {
    expect(() => {
      assertSelectablePages([], 3);
    }).toThrow(LiaisoPdfError);
  });
});

describe("document shape", () => {
  it("counts pages from the extraction, not from the classifier", async () => {
    const bytes = textPdf([["one"], ["two"], ["three"], ["four"]]);
    const extracted = await extractAll(bytes, "generated.pdf");
    expect(extracted.pageCount).toBe(4);
  });

  it("marks a scanned page rather than dropping it", async () => {
    const bytes = pdfWithPages([{ kind: "image" }]);
    const extracted = await extractAll(bytes, "generated.pdf");
    expect(extracted.pages).toHaveLength(1);
    expect(extracted.pages[0]?.needsOcr).toBe(true);
    expect(extracted.pages[0]?.page).toBe(1);
  });
});

describe("page budget", () => {
  /**
   * Enforced on the classifier's count, which is roughly a millisecond, so a
   * document that cannot be answered is refused before the extraction that
   * would materialise every page of it.
   */
  it("refuses a document with more pages than the server reads", () => {
    expect(() => {
      assertWithinPageBudget(limits.maxPages + 1, "huge.pdf");
    }).toThrow(LiaisoPdfError);
  });

  it("admits a document at the ceiling", () => {
    expect(() => {
      assertWithinPageBudget(limits.maxPages, "big.pdf");
    }).not.toThrow();
  });

  it("names the count and the ceiling so the caller can act", () => {
    expect(() => {
      assertWithinPageBudget(5000, "huge.pdf");
    }).toThrow(/5000 pages.*at most 2000/);
  });
});
