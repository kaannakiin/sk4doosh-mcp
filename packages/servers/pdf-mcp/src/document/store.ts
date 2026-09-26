import { relative } from "node:path";
import {
  contentFingerprint,
  createDocumentStore,
  type DocumentStore,
  type Fingerprint,
  type OpenedFile,
  type ParseContext,
  type SandboxedPath,
} from "@liaiso/file-core";
import type { DocumentRoot } from "../platform/paths.js";
import { classify, extractAll } from "../engine/inspector.js";
import { assertWithinPageBudget } from "../engine/pages.js";
import { LiaisoPdfError, fail } from "../platform/errors.js";
import { limits, modePolicy } from "../platform/limits.js";
import { vocabulary } from "../platform/vocabulary.js";
import { bodyOf, type PdfBody } from "./extraction.js";

export type LoadedPdf = PdfBody & OpenedFile;

export interface PdfDocumentStore {
  load(path: SandboxedPath): Promise<LoadedPdf>;
  clear(): void;
  readonly size: number;
}

async function bytesOf(context: ParseContext): Promise<Buffer> {
  if (context.mode === "resident") {
    return context.bytes;
  }
  return context.source.read({ offset: 0, length: context.sizeBytes });
}

/**
 * Re-reads the bytes an OCR rasterizer needs, which the parsed body does not
 * retain.
 *
 * Guard: the fingerprint is recomputed and compared to the one the caller holds.
 * Rasterizing a file that changed after it was parsed would transcribe one
 * document's pixels into another document's page numbers.
 */
export async function readDocumentBytes(
  root: DocumentRoot,
  path: SandboxedPath,
  stamp: Fingerprint,
): Promise<Buffer> {
  const snapshot = await root.access.read(
    relative(root.real, path),
    limits.maxPdfBytes,
  );
  if (contentFingerprint(path, snapshot.bytes, "") !== stamp) {
    throw new LiaisoPdfError(
      "file_changed",
      "The document changed while it was being read.",
      "Call the tool again.",
    );
  }
  return snapshot.bytes;
}

export function createPdfDocumentStore(
  root?: string,
  maxEntries: number = limits.documentCacheSize,
): PdfDocumentStore {
  const store: DocumentStore<PdfBody, undefined> = createDocumentStore<
    PdfBody,
    undefined
  >({
    maxEntries,
    maxBytes: limits.maxPdfBytes,
    mode: modePolicy,
    ...(root === undefined ? {} : { root }),
    vocabulary,
    fail,
    /**
     * Guard: one variant only. describe_document reads the same extraction
     * read_pages needs, so a "cheap classify" variant would buy a second read of
     * the same bytes and a second cache entry for no gain.
     */
    variantKey: () => "",
    /**
     * Guard: no deadline here. The caller owns it, because only the caller can
     * hold the concurrency slot until this promise settles — a race inside the
     * store would hide the still-running work behind an early rejection.
     */
    parse: async (context) => {
      const bytes = await bytesOf(context);
      const subject = context.displayPath;
      const classification = await classify(bytes, subject);
      assertWithinPageBudget(classification.pageCount, subject);
      const extraction = await extractAll(bytes, subject);
      return bodyOf(classification, extraction);
    },
  });
  return {
    load: (path) => store.load(path, undefined),
    clear: () => {
      store.clear();
    },
    get size() {
      return store.size;
    },
  };
}
