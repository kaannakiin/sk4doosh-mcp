export interface PdfCapabilities {
  readonly pageMarkdown: boolean;
  readonly literalSearch: boolean;
  readonly perPageOcrDetection: boolean;
  readonly ocr: boolean;
  readonly tableExtraction: boolean;
  readonly regionExtraction: boolean;
  readonly textPositions: boolean;
  readonly passwordProtected: boolean;
  readonly write: boolean;
}

/**
 * Guard: ocr reports whether a provider is actually bound, not whether the
 * feature exists in the code. It is reported rather than omitted so an agent can
 * tell "this server cannot read scanned pages" from "this document happens to
 * have none".
 */
export function capabilitiesWith(ocr: boolean): PdfCapabilities {
  return { ...capabilities, ocr };
}

export const capabilities: PdfCapabilities = {
  pageMarkdown: true,
  literalSearch: true,
  perPageOcrDetection: true,
  ocr: false,
  tableExtraction: false,
  regionExtraction: false,
  textPositions: false,
  passwordProtected: false,
  write: false,
};
