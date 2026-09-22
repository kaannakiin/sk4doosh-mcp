import type { Fingerprint } from "@sk-mcp/file-core";
import type { ExtractedPage } from "../engine/inspector.js";
import { resolvedPagesOf, type ResolvedPage } from "../document/extraction.js";
import { SkMcpPdfError } from "../platform/errors.js";
import { limits } from "../platform/limits.js";
import type { OcrBinding, RecognizedPage, RenderedPage } from "./port.js";

export interface OcrOutcome {
  readonly pages: readonly ResolvedPage[];
  readonly recognizedPages: readonly number[];
  readonly remainingOcrPages: readonly number[];
  readonly provider: string;
  readonly truncated: boolean;
}

export interface OcrCache {
  get(stamp: Fingerprint, page: number): RecognizedPage | undefined;
  set(stamp: Fingerprint, page: number, value: RecognizedPage): void;
  readonly size: number;
}

export function createOcrCache(
  maxEntries: number = limits.ocrCacheEntries,
): OcrCache {
  const entries = new Map<string, RecognizedPage>();
  const keyOf = (stamp: Fingerprint, page: number): string =>
    `${stamp}\u0000${String(page)}`;
  return {
    get(stamp, page) {
      return entries.get(keyOf(stamp, page));
    },
    set(stamp, page, value) {
      const key = keyOf(stamp, page);
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * Guard: neither port is cancellable by contract, so the deadline refuses the
 * request while the provider keeps working. It bounds what an agent waits for,
 * not what the host spends; the concurrency gate bounds the latter. The signal
 * is passed along so a port that does honour it can stop early.
 */
async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  stage: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new SkMcpPdfError(
          "ocr_failed",
          `OCR ${stage} exceeded the ${String(timeoutMs)} ms budget.`,
          "Request fewer pages, or configure a faster provider.",
        ),
      );
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([run(controller.signal), expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function asOcrFailure(error: unknown, stage: string): SkMcpPdfError {
  if (error instanceof SkMcpPdfError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new SkMcpPdfError(
    "ocr_failed",
    `The OCR ${stage} step failed: ${detail}`,
    "The page keeps its original needsOcr marking; no text was invented for it.",
  );
}

/**
 * Guard: a port may answer in any order, skip a page or invent one. Results are
 * matched by page number against what was asked for, and anything unrequested is
 * dropped — otherwise a provider could overwrite a page whose native text was
 * trustworthy.
 */
function indexByRequestedPage<T extends { readonly page: number }>(
  values: readonly T[],
  requested: readonly number[],
): Map<number, T> {
  const wanted = new Set(requested);
  const byPage = new Map<number, T>();
  for (const value of values) {
    if (wanted.has(value.page)) byPage.set(value.page, value);
  }
  return byPage;
}

export async function applyOcr(
  binding: OcrBinding,
  cache: OcrCache,
  input: {
    readonly bytes: Buffer;
    readonly stamp: Fingerprint;
    readonly pages: readonly ExtractedPage[];
    readonly wanted: readonly number[];
  },
): Promise<OcrOutcome> {
  const candidates = input.pages
    .filter((page) => page.needsOcr)
    .map((page) => page.page)
    .filter((page) => input.wanted.includes(page));

  const recognized = new Map<number, RecognizedPage>();
  const pending: number[] = [];
  for (const page of candidates) {
    const cached = cache.get(input.stamp, page);
    if (cached === undefined) pending.push(page);
    else recognized.set(page, cached);
  }

  const perCall = Math.min(
    binding.maxPagesPerCall ?? limits.maxOcrPagesPerCall,
    limits.maxOcrPagesPerCall,
  );
  const batch = pending.slice(0, perCall);
  const truncated = batch.length < pending.length;

  if (batch.length > 0) {
    const timeoutMs = Math.min(
      binding.timeoutMs ?? limits.maxOcrMs,
      limits.maxOcrMs,
    );
    const dpi = binding.dpi ?? limits.ocrDpi;
    let rendered: readonly RenderedPage[];
    try {
      rendered = await withDeadline(
        (signal) =>
          binding.rasterizer.render({
            bytes: input.bytes,
            pages: batch,
            dpi,
            signal,
          }),
        timeoutMs,
        "rasterization",
      );
    } catch (error) {
      throw asOcrFailure(error, "rasterization");
    }
    const images = indexByRequestedPage(rendered, batch);
    const usable = batch
      .map((page) => images.get(page))
      .filter((page): page is RenderedPage => page !== undefined);

    if (usable.length > 0) {
      let answers: readonly RecognizedPage[];
      try {
        answers = await withDeadline(
          (signal) => binding.provider.recognize({ pages: usable, signal }),
          timeoutMs,
          "recognition",
        );
      } catch (error) {
        throw asOcrFailure(error, "recognition");
      }
      const byPage = indexByRequestedPage(answers, batch);
      for (const [page, answer] of byPage) {
        /**
         * Guard: an empty transcription is not an answer. Keeping the page
         * marked needsOcr is the honest outcome — replacing it would turn "the
         * model returned nothing" into "this page is blank".
         */
        if (answer.markdown.trim() === "") continue;
        cache.set(input.stamp, page, answer);
        recognized.set(page, answer);
      }
    }
  }

  const pages: readonly ResolvedPage[] = resolvedPagesOf(input.pages).map(
    (page) => {
      const answer = recognized.get(page.page);
      if (answer === undefined) return page;
      return {
        page: page.page,
        markdown: answer.markdown,
        needsOcr: false,
        source: "ocr",
        ...(answer.confidence === undefined
          ? {}
          : { ocrConfidence: answer.confidence }),
      };
    },
  );

  const recognizedPages = [...recognized.keys()].sort((a, b) => a - b);
  return {
    pages,
    recognizedPages,
    remainingOcrPages: pages
      .filter((page) => page.needsOcr)
      .map((page) => page.page),
    provider: binding.provider.name,
    truncated,
  };
}
