import type { Fingerprint } from "@liaiso/file-core";
import type { ExtractedPage } from "../engine/inspector.js";
import { resolvedPagesOf, type ResolvedPage } from "../document/extraction.js";
import { LiaisoPdfError } from "../platform/errors.js";
import { limits } from "../platform/limits.js";
import type { OcrBinding, RecognizedPage, RenderedPage } from "./port.js";

export interface OcrOutcome {
  readonly pages: readonly ResolvedPage[];
  readonly recognizedPages: readonly number[];
  readonly remainingOcrPages: readonly number[];
  /**
   * Wanted pages whose text may still arrive in a later call, because this
   * round's batch stopped short of them. A reader must not walk past one of
   * these: the page is not unreadable, it is unread. A page outside `wanted` is
   * never pending — its transcription leaving the cache says nothing about
   * whether it could be read.
   */
  readonly pendingPages: readonly number[];
  readonly provider: string;
  readonly truncated: boolean;
}

/**
 * Guard: an attempt that produced nothing is remembered as an attempt. Without
 * that, a page the provider cannot transcribe looks "not yet tried" on every
 * subsequent call, and a reader that refuses to walk past an untried page never
 * advances. The page still keeps its needsOcr marking — remembering the failure
 * is not the same as inventing text for it.
 */
export type CachedOcr =
  | { readonly kind: "text"; readonly value: RecognizedPage }
  | { readonly kind: "empty" };

export interface OcrCache {
  get(stamp: Fingerprint, page: number): CachedOcr | undefined;
  set(stamp: Fingerprint, page: number, value: CachedOcr): void;
  readonly size: number;
}

export function createOcrCache(
  maxEntries: number = limits.ocrCacheEntries,
): OcrCache {
  const entries = new Map<string, CachedOcr>();
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

function asOcrFailure(error: unknown, stage: string): LiaisoPdfError {
  if (error instanceof LiaisoPdfError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new LiaisoPdfError(
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
    readonly signal?: AbortSignal;
  },
): Promise<OcrOutcome> {
  const wanted = new Set(input.wanted);
  const candidates = input.pages
    .filter((page) => page.needsOcr && wanted.has(page.page))
    .map((page) => page.page);

  const recognized = new Map<number, RecognizedPage>();
  const untried: number[] = [];
  for (const page of candidates) {
    const cached = cache.get(input.stamp, page);
    if (cached === undefined) {
      untried.push(page);
      continue;
    }
    if (cached.kind === "text") recognized.set(page, cached.value);
  }

  const perCall = Math.min(
    binding.maxPagesPerCall ?? limits.maxOcrPagesPerCall,
    limits.maxOcrPagesPerCall,
  );
  const batch = untried.slice(0, perCall);
  const truncated = batch.length < untried.length;
  const attempted = new Set(batch);

  if (batch.length > 0) {
    const dpi = binding.dpi ?? limits.ocrDpi;
    let rendered: readonly RenderedPage[];
    try {
      rendered = await binding.rasterizer.render({
        bytes: input.bytes,
        pages: batch,
        dpi,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } catch (error) {
      throw asOcrFailure(error, "rasterization");
    }
    const images = indexByRequestedPage(rendered, batch);
    const usable = batch
      .map((page) => images.get(page))
      .filter((page): page is RenderedPage => page !== undefined);
    for (const page of batch) {
      if (!images.has(page)) cache.set(input.stamp, page, { kind: "empty" });
    }

    if (usable.length > 0) {
      let answers: readonly RecognizedPage[];
      try {
        answers = await binding.provider.recognize({
          pages: usable,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
      } catch (error) {
        throw asOcrFailure(error, "recognition");
      }
      /**
       * Guard: answers are matched against the pages that actually reached
       * recognize(), not against the pages the rasterizer was asked for. A page
       * the rasterizer silently omitted never became an image, so a provider
       * answering for it is answering about something it never saw.
       */
      const sent = usable.map((page) => page.page);
      const byPage = indexByRequestedPage(answers, sent);
      for (const page of sent) {
        const answer = byPage.get(page);
        /**
         * Guard: an empty transcription is not an answer. Keeping the page
         * marked needsOcr is the honest outcome — replacing it would turn "the
         * model returned nothing" into "this page is blank".
         */
        if (answer === undefined || answer.markdown.trim() === "") {
          cache.set(input.stamp, page, { kind: "empty" });
          continue;
        }
        cache.set(input.stamp, page, { kind: "text", value: answer });
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
  const remaining = pages
    .filter((page) => page.needsOcr)
    .map((page) => page.page);
  return {
    pages,
    recognizedPages,
    remainingOcrPages: remaining,
    pendingPages: remaining.filter(
      (page) =>
        wanted.has(page) &&
        !attempted.has(page) &&
        cache.get(input.stamp, page) === undefined,
    ),
    provider: binding.provider.name,
    truncated,
  };
}
