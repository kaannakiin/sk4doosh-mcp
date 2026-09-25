import { describePdfInputSchema } from "./describe-pdf.ts";
import { findInPdfInputSchema } from "./find-in-pdf.ts";
import { listPdfsInputSchema } from "./list-pdfs.ts";
import { readPdfPagesInputSchema } from "./read-pdf-pages.ts";

/**
 * The PDF reader's tool surface as this product exposes it.
 *
 * Guard: every tool is renamed, and `serverName` is what the MCP client is asked
 * for. The PDF server calls its first tool `describe_document`, the same name the
 * XML reader uses, and a session holding both files merges the two tool sets into
 * one object — under a shared key one reader silently replaces the other. The
 * description is replaced along with the name, because the server's own text
 * points the model at `describe_document` and `read_pages`, which in this product
 * name a different reader or nothing. `list_documents` is renamed for the same
 * collision: the XML reader exposes a tool of that name.
 */
export const PDF_TOOL_SCHEMAS = {
  describe_pdf: {
    serverName: "describe_document",
    description:
      "Summarise one attached PDF: its page count, document type, and which pages have no readable text and need OCR, and whether OCR is available (capabilities.ocr). Calling this first is optional; read_pdf_pages and find_in_pdf work from filePath alone.",
    inputSchema: describePdfInputSchema,
  },
  read_pdf_pages: {
    serverName: "read_pages",
    description:
      "Read selected pages of an attached PDF as Markdown, one entry per page, page numbers counted from 1. A page whose text could not be extracted comes back with needsOcr true rather than as an empty page: read it again with ocr true when OCR is available, otherwise say it could not be read instead of guessing its content. Each page reports source: text or ocr. When a response is cut short, pass its nextCursor to continue.",
    inputSchema: readPdfPagesInputSchema,
  },
  find_in_pdf: {
    serverName: "find_in_document",
    description:
      "Find literal text in an attached PDF and return each match with its page number and surrounding context. The query is matched literally, never as a regular expression. Pages without readable text are counted in unsearchablePages: when coverageComplete is false, no match means the text was not found in the pages that could be read, not that it is absent from the document.",
    inputSchema: findInPdfInputSchema,
  },
  list_pdfs: {
    serverName: "list_documents",
    description:
      "List the PDF documents attached to this conversation. Returns filePath values that the other PDF tools accept verbatim. A listed path is a candidate: the listing never opens the file.",
    inputSchema: listPdfsInputSchema,
  },
} as const;

export type PdfToolSchemas = typeof PDF_TOOL_SCHEMAS;
