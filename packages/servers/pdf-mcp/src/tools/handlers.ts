import {
  clampJsonField,
  createPageBudget,
  json,
  measureJson,
  type Fingerprint,
} from "@sk-mcp/file-core";

import { assertSelectablePages } from "../engine/pages.js";
import {
  createPdfDocumentStore,
  readDocumentBytes,
  type LoadedPdf,
  type PdfDocumentStore,
} from "../document/store.js";
import {
  pageAt,
  resolvedPagesOf,
  type ResolvedPage,
} from "../document/extraction.js";
import { applyOcr, createOcrCache, type OcrCache } from "../ocr/apply.js";
import type { OcrBinding } from "../ocr/port.js";
import { capabilitiesWith } from "../platform/capabilities.js";
import { SkMcpPdfError } from "../platform/errors.js";
import { createGate, type Gate } from "../platform/gate.js";
import { limits, modePolicy } from "../platform/limits.js";
import {
  listDocuments,
  resolveDocumentPath,
  type DocumentRoot,
  type SandboxedPath,
} from "../platform/paths.js";
import {
  scanLiteral,
  type LiteralMatch,
  type MatchMode,
} from "../search/literal.js";
import {
  assertFresh,
  assertSameOptions,
  cursorTtlMs,
  decodeCursor,
  encodePosition,
  optionsHash,
  type PdfPosition,
} from "./cursor.js";
import type { ToolHandlers } from "./definitions.js";
import { guard } from "./guard.js";

export interface PdfHandlerDeps {
  readonly store?: PdfDocumentStore;
  readonly ocr?: OcrBinding;
  readonly maxConcurrentListings?: number;
  readonly maxConcurrentExtractions?: number;
}

interface PageEntry {
  readonly page: number;
  readonly markdown: string;
  readonly needsOcr: boolean;
  readonly empty: boolean;
  readonly source: "text" | "ocr";
  readonly ocrReason?: string;
  readonly ocrConfidence?: number;
  readonly truncatedMarkdown?: true;
}

function entryFor(pages: readonly ResolvedPage[], page: number): PageEntry {
  const found = pageAt(pages, page);
  if (found === undefined) {
    throw new SkMcpPdfError(
      "invalid_argument",
      `The document has ${String(pages.length)} pages; page ${String(page)} does not exist.`,
    );
  }
  return {
    page: found.page,
    markdown: found.markdown,
    needsOcr: found.needsOcr,
    /**
     * Guard: empty is only true for a page the engine trusted and found blank.
     * Without the needsOcr term a scanned page would be indistinguishable from
     * a genuinely empty one, which is the failure this field exists to prevent.
     */
    empty: !found.needsOcr && found.markdown.trim() === "",
    source: found.source,
    ...(found.ocrReason === undefined ? {} : { ocrReason: found.ocrReason }),
    ...(found.ocrConfidence === undefined
      ? {}
      : { ocrConfidence: found.ocrConfidence }),
  };
}

function expiry(): number {
  return Date.now() + cursorTtlMs;
}

export function createHandlers(
  root: DocumentRoot,
  deps: PdfHandlerDeps = {},
): ToolHandlers {
  const store = deps.store ?? createPdfDocumentStore(root.real);
  const listings: Gate = createGate(
    deps.maxConcurrentListings ?? limits.maxConcurrentListings,
    () => {
      throw new SkMcpPdfError(
        "resource_limit",
        "Too many listings are already running.",
        "Retry once an earlier list_documents call finishes.",
      );
    },
  );
  const extractions: Gate = createGate(
    deps.maxConcurrentExtractions ?? limits.maxConcurrentExtractions,
    () => {
      throw new SkMcpPdfError(
        "resource_limit",
        "Too many documents are already being read.",
        "Retry once an earlier read finishes; PDF extraction is memory-bound.",
      );
    },
  );

  /**
   * Guard: the gate is taken before the bytes are read, so a waiting request
   * never pins a snapshot. It is also the only real bound on concurrent native
   * work — an extraction already running on the libuv pool cannot be cancelled.
   */
  const open = async (
    raw: string,
  ): Promise<{ path: SandboxedPath; loaded: LoadedPdf }> => {
    const path: SandboxedPath = await resolveDocumentPath(root, raw);
    const release = extractions.enter();
    try {
      return { path, loaded: await store.load(path) };
    } finally {
      release();
    }
  };

  const ocrCache: OcrCache = createOcrCache();
  const ocrRuns: Gate = createGate(limits.maxConcurrentOcr, () => {
    throw new SkMcpPdfError(
      "resource_limit",
      "An OCR run is already in progress.",
      "Retry once it finishes; transcription is the slowest thing this server does.",
    );
  });

  /**
   * Resolves the pages a tool will report. Without ocr the engine's extraction
   * is reported as-is; with it, pages the text layer could not answer are sent
   * to the injected ports.
   *
   * Guard: asking for OCR with no provider bound is an error, never a silent
   * fallback to the untranscribed pages. A caller that paid for the flag must
   * not be told "no matches" by a document nobody transcribed.
   */
  const resolve = async (
    path: SandboxedPath,
    loaded: LoadedPdf,
    wanted: readonly number[],
    requested: boolean,
  ): Promise<{
    pages: readonly ResolvedPage[];
    ocr?: {
      provider: string;
      recognizedPages: readonly number[];
      truncated: boolean;
    };
  }> => {
    if (!requested) return { pages: resolvedPagesOf(loaded.pages) };
    if (deps.ocr === undefined) {
      throw new SkMcpPdfError(
        "ocr_unavailable",
        "No OCR provider is configured, so pages without a text layer cannot be transcribed.",
        "Call describe_document and read capabilities.ocr, or omit ocr to read the text layer alone.",
      );
    }
    const binding = deps.ocr;
    const release = ocrRuns.enter();
    try {
      const bytes = await readDocumentBytes(root, path, loaded.stamp);
      const outcome = await applyOcr(binding, ocrCache, {
        bytes,
        stamp: loaded.stamp,
        pages: loaded.pages,
        wanted,
      });
      return {
        pages: outcome.pages,
        ocr: {
          provider: outcome.provider,
          recognizedPages: outcome.recognizedPages,
          truncated: outcome.truncated,
        },
      };
    } finally {
      release();
    }
  };

  const cursorFor = (stamp: Fingerprint, position: PdfPosition): string =>
    encodePosition(stamp, position);

  return {
    list_documents: guard(
      { root: root.real, tool: "list_documents" },
      async (args) => {
        const release = listings.enter();
        try {
          const listing = await listDocuments(root, {
            ...(args.subdirectory === undefined
              ? {}
              : { subdirectory: args.subdirectory }),
            ...(args.pattern === undefined ? {} : { pattern: args.pattern }),
            maxResults: args.maxResults ?? limits.defaultListResults,
            mode: modePolicy,
          });
          return json({ root: root.real, ...listing });
        } finally {
          release();
        }
      },
    ),

    describe_document: guard(
      { root: root.real, tool: "describe_document" },
      async (args) => {
        const { loaded } = await open(args.filePath);
        return json({
          filePath: args.filePath,
          pageCount: loaded.pageCount,
          documentType: loaded.documentType,
          classificationConfidence: loaded.classificationConfidence,
          pagesNeedingOcr: loaded.pagesNeedingOcr,
          needsOcr: loaded.pagesNeedingOcr.length > 0,
          pagesWithTables: loaded.pagesWithTables,
          capabilities: capabilitiesWith(deps.ocr !== undefined),
          ...(deps.ocr === undefined
            ? {}
            : { ocrProvider: deps.ocr.provider.name }),
          limits: {
            maxPages: limits.maxPages,
            maxPdfBytes: limits.maxPdfBytes,
            maxReadPages: limits.maxReadPages,
          },
          sizeBytes: loaded.sizeBytes,
          modifiedAt: loaded.modifiedAt,
          mode: loaded.mode,
        });
      },
    ),

    read_pages: guard({ root: root.real, tool: "read_pages" }, async (args) => {
      const maxPages = args.maxPages ?? limits.defaultReadPages;
      /**
       * Guard: page size is deliberately not part of the cursor identity. The
       * resume position is a page number, so walking with a different maxPages
       * still yields every page exactly once and in order. Only an option that
       * changes which pages answer the call belongs here, and read_pages has
       * none — an explicit selection cannot be combined with a cursor.
       */
      const hash = optionsHash({ tool: "read" });
      if (args.cursor !== undefined && args.pages !== undefined) {
        throw new SkMcpPdfError(
          "invalid_argument",
          "cursor cannot be combined with pages.",
          "The cursor already carries the position the previous page stopped at.",
        );
      }
      const cursor =
        args.cursor === undefined
          ? undefined
          : decodeCursor(args.cursor, "read");
      if (cursor !== undefined) assertSameOptions(cursor, hash);

      const { path, loaded } = await open(args.filePath);
      if (cursor !== undefined) assertFresh(cursor, loaded.stamp);

      const explicit = args.pages !== undefined;
      if (args.pages !== undefined) {
        assertSelectablePages(args.pages, loaded.pageCount);
      }
      const selection = explicit
        ? [...(args.pages ?? [])]
        : Array.from(
            { length: loaded.pageCount },
            (_unused, index) => index + 1,
          ).filter((page) => page >= (cursor?.p ?? 1));

      const resolved = await resolve(
        path,
        loaded,
        selection.slice(0, maxPages),
        args.ocr === true,
      );

      const reserveBytes =
        measureJson({
          filePath: args.filePath,
          pageCount: loaded.pageCount,
          returnedPages: maxPages,
          pages: [],
          truncated: true,
          truncationReason: "maxPayloadBytes",
          nextCursor: cursorFor(loaded.stamp, {
            t: "read",
            o: hash,
            x: expiry(),
            p: loaded.pageCount,
          }),
          pagesNeedingOcr: loaded.pagesNeedingOcr,
          mode: loaded.mode,
        }) + 64;
      const budget = createPageBudget({
        maxBytes: limits.maxPayloadBytes,
        reserveBytes,
      });

      const entries: PageEntry[] = [];
      let truncationReason: "maxPages" | "maxPayloadBytes" | undefined;
      let nextPage: number | undefined;

      for (const page of selection) {
        if (entries.length >= maxPages) {
          truncationReason = "maxPages";
          nextPage = page;
          break;
        }
        const entry = entryFor(resolved.pages, page);
        if (budget.admit(entry)) {
          entries.push(entry);
          continue;
        }
        if (entries.length === 0) {
          /**
           * Guard: the first page is clamped rather than refused, so a single
           * oversized page yields a usable prefix with truncatedMarkdown set
           * instead of an error the agent cannot act on.
           */
          const room = limits.maxPayloadBytes - reserveBytes;
          const clamped = clampJsonField(entry.markdown, room, (markdown) => ({
            ...entry,
            markdown,
            truncatedMarkdown: true,
          }));
          entries.push({
            ...entry,
            markdown: clamped,
            truncatedMarkdown: true,
          });
        }
        truncationReason = "maxPayloadBytes";
        nextPage =
          entries.length === 1 && entries[0]?.page === page ? page + 1 : page;
        break;
      }

      const truncated = truncationReason !== undefined;
      const more = nextPage !== undefined && nextPage <= loaded.pageCount;
      return json({
        filePath: args.filePath,
        pageCount: loaded.pageCount,
        returnedPages: entries.length,
        pages: entries,
        pagesNeedingOcr: resolved.pages
          .filter((page) => page.needsOcr)
          .map((page) => page.page),
        ...(resolved.ocr === undefined ? {} : { ocr: resolved.ocr }),
        truncated,
        ...(truncationReason === undefined ? {} : { truncationReason }),
        /**
         * Guard: an explicit selection gets no cursor. Resuming a hand-picked
         * page list through an ordinal would silently change which pages the
         * caller asked for; they re-request the pages they still want.
         */
        ...(more && !explicit
          ? {
              nextCursor: cursorFor(loaded.stamp, {
                t: "read",
                o: hash,
                x: expiry(),
                p: nextPage ?? loaded.pageCount,
              }),
            }
          : {}),
        mode: loaded.mode,
      });
    }),

    find_in_document: guard(
      { root: root.real, tool: "find_in_document" },
      async (args) => {
        const matchMode: MatchMode = args.matchMode ?? "contains";
        const caseSensitive = args.caseSensitive ?? true;
        const maxResults = args.maxResults ?? limits.defaultFindResults;
        /**
         * Guard: query, matchMode and caseSensitive decide which matches exist and
         * so must survive a resume. maxResults only decides how many are handed
         * back per call, and the resume position is a (page, ordinal) pair, so
         * changing it mid-walk can neither skip nor repeat a match.
         */
        const hash = optionsHash({
          query: args.query,
          matchMode,
          caseSensitive,
        });
        const cursor =
          args.cursor === undefined
            ? undefined
            : decodeCursor(args.cursor, "find");
        if (cursor !== undefined) assertSameOptions(cursor, hash);

        const { path, loaded } = await open(args.filePath);
        if (cursor !== undefined) assertFresh(cursor, loaded.stamp);

        const resolved = await resolve(
          path,
          loaded,
          Array.from({ length: loaded.pageCount }, (_unused, i) => i + 1),
          args.ocr === true,
        );

        const scan = scanLiteral(resolved.pages, {
          query: args.query,
          matchMode,
          caseSensitive,
          maxResults,
          ...(cursor === undefined
            ? {}
            : { from: { page: cursor.p, ordinal: cursor.i } }),
        });

        const reserveBytes =
          measureJson({
            filePath: args.filePath,
            query: args.query,
            matches: [],
            searchedPages: loaded.pageCount,
            pageCount: loaded.pageCount,
            unsearchablePages: scan.unsearchablePages,
            pagesNeedingOcr: loaded.pagesNeedingOcr,
            coverageComplete: false,
            truncated: true,
            note: "",
            nextCursor: cursorFor(loaded.stamp, {
              t: "find",
              o: hash,
              x: expiry(),
              p: loaded.pageCount,
              i: 0,
            }),
          }) + 256;
        const budget = createPageBudget({
          maxBytes: limits.maxPayloadBytes,
          reserveBytes,
        });

        const admitted: LiteralMatch[] = [];
        let cut: { page: number; ordinal: number } | undefined;
        for (const match of scan.matches) {
          if (budget.admit(match)) {
            admitted.push(match);
            continue;
          }
          cut = { page: match.page, ordinal: match.ordinal };
          break;
        }
        const next = cut ?? scan.next;
        const coverageComplete =
          scan.unsearchablePages === 0 && next === undefined;

        return json({
          filePath: args.filePath,
          query: args.query,
          matchMode,
          matches: admitted,
          searchedPages: scan.searchedPages,
          pageCount: loaded.pageCount,
          unsearchablePages: scan.unsearchablePages,
          pagesNeedingOcr: resolved.pages
            .filter((page) => page.needsOcr)
            .map((page) => page.page),
          ...(resolved.ocr === undefined ? {} : { ocr: resolved.ocr }),
          coverageComplete,
          truncated: next !== undefined,
          ...(scan.unsearchablePages > 0
            ? {
                note: `${String(scan.unsearchablePages)} of ${String(loaded.pageCount)} pages carry no readable text and were not searched; an empty result is not proof the text is absent from the document.`,
              }
            : {}),
          ...(next === undefined
            ? {}
            : {
                nextCursor: cursorFor(loaded.stamp, {
                  t: "find",
                  o: hash,
                  x: expiry(),
                  p: next.page,
                  i: next.ordinal,
                }),
              }),
          mode: loaded.mode,
        });
      },
    ),
  };
}
