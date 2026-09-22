import { relative } from "node:path";
import {
  contentFingerprint,
  createDocumentStore,
  type DocumentStore,
  type Fingerprint,
  type OpenedFile,
  type ParseContext,
  type SandboxedPath,
} from "@sk-mcp/file-core";
import type { DocumentRoot } from "../platform/paths.js";
import { classify, extractAll } from "../engine/inspector.js";
import { SkMcpPdfError, fail } from "../platform/errors.js";
import { limits, modePolicy } from "../platform/limits.js";
import { vocabulary } from "../platform/vocabulary.js";
import { bodyOf, type PdfBody } from "./extraction.js";

export type LoadedPdf = PdfBody & OpenedFile;

export interface PdfDocumentStore {
  load(path: SandboxedPath): Promise<LoadedPdf>;
  clear(): void;
  readonly size: number;
}

/**
 * Guard: the native extraction runs on the libuv pool and cannot be interrupted
 * once it has started, so this deadline refuses the request while the work keeps
 * running to completion. It bounds what an agent waits for, not what the process
 * spends — the concurrency gate is what bounds the latter.
 */
async function withDeadline<T>(
  run: () => Promise<T>,
  subject: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new SkMcpPdfError(
          "resource_limit",
          `Reading '${subject}' exceeded the ${String(limits.maxExtractMs)} ms extraction budget.`,
          "Read a smaller document; the work already started is not cancelled.",
        ),
      );
    }, limits.maxExtractMs);
    timer.unref();
  });
  try {
    return await Promise.race([run(), expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
    throw new SkMcpPdfError(
      "file_changed",
      "The document changed while it was being read.",
      "Call the tool again.",
    );
  }
  return snapshot.bytes;
}

export function createPdfDocumentStore(root?: string): PdfDocumentStore {
  const store: DocumentStore<PdfBody, undefined> = createDocumentStore<
    PdfBody,
    undefined
  >({
    maxEntries: limits.documentCacheSize,
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
    parse: async (context) => {
      const bytes = await bytesOf(context);
      const subject = context.displayPath;
      return withDeadline(async () => {
        const classification = await classify(bytes, subject);
        const extraction = await extractAll(bytes, subject);
        return bodyOf(classification, extraction);
      }, subject);
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
