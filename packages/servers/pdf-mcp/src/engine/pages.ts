import { SkMcpPdfError } from "../platform/errors.js";
import { limits } from "../platform/limits.js";

/**
 * Guard: the library mixes bases within a single result — `PageMarkdownResult.page`
 * is 0-based while the sibling `pagesNeedingOcr` array is 1-based, and
 * `classifyPdf` reports the same concept 0-based where `processPdf` reports it
 * 1-based. Every conversion lives here and lint keeps the library import inside
 * this folder, so there is exactly one place the base can be wrong.
 * docs/pdf-motoru-karari.md records the measurement.
 */
export function toOneBased(zeroBased: number): number {
  return zeroBased + 1;
}

export function toZeroBased(oneBased: number): number {
  return oneBased - 1;
}

/**
 * Guard: an out-of-range index is not refused by the library — it answers with a
 * phantom `{ page, markdown: "", needsOcr: true }`, and a negative one wraps
 * through u32 to 4294967295. Both would reach the agent as "a page that needs
 * OCR". Selection is validated against the real page count before any call.
 */
export function assertSelectablePages(
  pages: readonly number[],
  pageCount: number,
): void {
  if (pages.length === 0) {
    throw new SkMcpPdfError(
      "invalid_argument",
      "pages must name at least one page.",
      "Omit pages to read from the first page.",
    );
  }
  if (pages.length > limits.maxReadPages) {
    throw new SkMcpPdfError(
      "invalid_argument",
      `pages names ${String(pages.length)} pages; at most ${String(limits.maxReadPages)} may be requested at once.`,
    );
  }
  for (const page of pages) {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new SkMcpPdfError(
        "invalid_argument",
        `'${String(page)}' is not a page number; pages are numbered from 1.`,
      );
    }
    if (page > pageCount) {
      throw new SkMcpPdfError(
        "invalid_argument",
        `The document has ${String(pageCount)} pages; page ${String(page)} does not exist.`,
        "Call describe_document to read pageCount.",
      );
    }
  }
}
