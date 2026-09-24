import type { SourceMode } from "@sk-mcp/file-core";
import type {
  ClassifiedPdf,
  ExtractedPage,
  ExtractedPdf,
} from "../engine/inspector.js";

/**
 * The cached body of one document: the classifier's document-level verdict and
 * the per-page extraction, both produced by a single read.
 *
 * Guard: `documentType` comes from the classifier and `pagesNeedingOcr` from the
 * per-page extraction, and neither is derived from the other. The classifier
 * reports every page of a document that contains one image page, so using it as
 * a page list would overstate what needs OCR by an order of magnitude —
 * measured on 1.23.0, a 10-page document with one image page came back with all
 * 10 flagged, while the per-page extraction flagged the one.
 */
export interface PdfBody {
  readonly format: "pdf";
  readonly documentType: ClassifiedPdf["documentType"];
  readonly classificationConfidence: number;
  readonly pageCount: number;
  readonly pages: readonly ExtractedPage[];
  readonly pagesNeedingOcr: readonly number[];
  readonly pagesWithTables: readonly number[];
}

export function bodyOf(
  classification: ClassifiedPdf,
  extraction: ExtractedPdf,
): PdfBody {
  return {
    format: "pdf",
    documentType: classification.documentType,
    classificationConfidence: classification.classificationConfidence,
    pageCount: extraction.pageCount,
    pages: extraction.pages,
    pagesNeedingOcr: extraction.pagesNeedingOcr,
    pagesWithTables: extraction.pagesWithTables,
  };
}

/**
 * A page as the tools report it: the engine's extraction, plus where the text
 * finally came from. `source` is data, not a guess — only a page an OCR provider
 * actually answered for becomes "ocr".
 */
export interface ResolvedPage extends ExtractedPage {
  readonly source: "text" | "ocr";
  readonly ocrConfidence?: number;
}

export function resolvedPagesOf(
  pages: readonly ExtractedPage[],
): readonly ResolvedPage[] {
  return pages.map((page) => ({ ...page, source: "text" }));
}

export function pageAt(
  pages: readonly ResolvedPage[],
  oneBased: number,
): ResolvedPage | undefined {
  return pages[oneBased - 1];
}

export interface DocumentFacts {
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly mode: SourceMode;
}
