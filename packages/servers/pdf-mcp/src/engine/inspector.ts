import {
  classifyPdfAsync,
  extractPagesMarkdownAsync,
} from "@firecrawl/pdf-inspector";
import { SkMcpPdfError } from "../platform/errors.js";
import { limits } from "../platform/limits.js";
import { toOneBased } from "./pages.js";

export type DocumentType = "text_based" | "scanned" | "image_based" | "mixed";

export interface ClassifiedPdf {
  readonly documentType: DocumentType;
  readonly classificationConfidence: number;
  readonly pageCount: number;
}

export interface ExtractedPage {
  readonly page: number;
  readonly markdown: string;
  readonly needsOcr: boolean;
  readonly ocrReason?: string;
}

export interface ExtractedPdf {
  readonly pageCount: number;
  readonly pages: readonly ExtractedPage[];
  readonly pagesNeedingOcr: readonly number[];
  readonly pagesWithTables: readonly number[];
}

const documentTypes: Readonly<Record<string, DocumentType>> = {
  TextBased: "text_based",
  Scanned: "scanned",
  ImageBased: "image_based",
  Mixed: "mixed",
};

/**
 * Guard: every failure arrives as a bare Error whose `code` is napi's
 * `GenericFailure`, so only the message distinguishes an encrypted file from a
 * corrupt one. The three observed messages are pinned by inspector.spec.ts — a
 * library upgrade that reworded them degrades to extraction_failed instead of
 * mislabelling, and the test says so out loud.
 */
function asEngineError(error: unknown, subject: string): SkMcpPdfError {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes("PDF is encrypted")) {
    return new SkMcpPdfError(
      "encrypted_pdf",
      `'${subject}' is password-protected and cannot be read.`,
      "This server never asks for a password; supply an unprotected copy.",
    );
  }
  if (
    detail.includes("Not a PDF") ||
    detail.includes("Invalid PDF structure")
  ) {
    return new SkMcpPdfError(
      "malformed_pdf",
      `'${subject}' is not a readable PDF document.`,
      "The file may be truncated or may not be a PDF despite its extension.",
    );
  }
  return new SkMcpPdfError(
    "extraction_failed",
    `'${subject}' could not be read by the PDF engine.`,
    "Retrying the same call will not help; the document may use an unsupported feature.",
  );
}

export async function classify(
  bytes: Buffer,
  subject: string,
): Promise<ClassifiedPdf> {
  let result;
  try {
    result = await classifyPdfAsync(bytes);
  } catch (error) {
    throw asEngineError(error, subject);
  }
  return {
    documentType: documentTypes[result.pdfType as string] ?? "mixed",
    classificationConfidence: result.confidence,
    pageCount: result.pageCount,
  };
}

export async function extractAll(
  bytes: Buffer,
  subject: string,
): Promise<ExtractedPdf> {
  let result;
  try {
    result = await extractPagesMarkdownAsync(bytes);
  } catch (error) {
    throw asEngineError(error, subject);
  }
  const pages: ExtractedPage[] = result.pages.map((page) => ({
    page: toOneBased(page.page),
    markdown: page.markdown,
    needsOcr: page.needsOcr,
    ...(page.ocrReason === undefined ? {} : { ocrReason: page.ocrReason }),
  }));
  if (pages.length > limits.maxPages) {
    throw new SkMcpPdfError(
      "resource_limit",
      `'${subject}' has ${String(pages.length)} pages; this server reads at most ${String(limits.maxPages)}.`,
    );
  }
  return {
    pageCount: pages.length,
    pages,
    /**
     * Guard: derived from each page's own needsOcr rather than read from the
     * result's 1-based pagesNeedingOcr array. The two agreed in every measured
     * case, and deriving keeps one more mixed-base field out of the code.
     */
    pagesNeedingOcr: pages
      .filter((page) => page.needsOcr)
      .map((page) => page.page),
    pagesWithTables: [...result.pagesWithTables],
  };
}
