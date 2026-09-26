import { asciiLower, truncateWellFormed } from "@liaiso/file-core";
import { limits } from "../platform/limits.js";
import type { ExtractedPage } from "../engine/inspector.js";

export type MatchMode = "contains" | "exact";

export interface LiteralMatch {
  readonly page: number;
  readonly line: number;
  readonly context: string;
  /** Page-local match ordinal, so a caller can resume at any cut point. */
  readonly ordinal: number;
}

export interface ScanPosition {
  readonly page: number;
  readonly ordinal: number;
}

/**
 * Guard: a walk's coverage is carried with its position rather than recounted
 * from the pages behind it. Behind the cursor those pages are no longer
 * resolved, so their transcriptions can leave the cache, and a recount would
 * report as searched a page that never yielded text.
 */
export interface ScanResume extends ScanPosition {
  readonly unsearchableBehind: number;
}

export interface ScanOptions {
  readonly query: string;
  readonly matchMode: MatchMode;
  readonly caseSensitive: boolean;
  readonly maxResults: number;
  readonly from?: ScanResume;
  /**
   * Pages whose text may still arrive, because an OCR provider has not reached
   * them yet. The scan stops before the first of them instead of skipping it:
   * a page that becomes readable after the cursor has walked past would lose
   * every match it carries, and the walk would still look complete.
   */
  readonly pending?: ReadonlySet<number>;
}

export interface ScanResult {
  readonly matches: readonly LiteralMatch[];
  readonly searchedPages: number;
  readonly unsearchablePages: number;
  readonly next?: ScanResume;
}

function isUnsearchable(
  page: ExtractedPage,
  pending: ReadonlySet<number>,
): boolean {
  return page.needsOcr && !pending.has(page.page);
}

/** The resume point for `position`, with the coverage the walk has passed. */
export function resumeAt(
  pages: readonly ExtractedPage[],
  options: Pick<ScanOptions, "from" | "pending">,
  position: ScanPosition,
): ScanResume {
  const startPage = options.from?.page ?? 1;
  const pending = options.pending ?? new Set<number>();
  const passed = pages.filter(
    (page) =>
      page.page >= startPage &&
      page.page < position.page &&
      isUnsearchable(page, pending),
  ).length;
  return {
    ...position,
    unsearchableBehind: (options.from?.unsearchableBehind ?? 0) + passed,
  };
}

/**
 * Guard: asciiLower is length-preserving, which is what keeps a match offset
 * valid in the original text. fold() would be the better linguistic answer and
 * the wrong one here — it normalises through NFD and can change length, so every
 * offset computed against it would point into the wrong place in the source
 * line. The tool description states that folding is ASCII-only.
 */
function comparable(text: string, caseSensitive: boolean): string {
  return caseSensitive ? text : asciiLower(text);
}

function contextAround(line: string, offset: number, length: number): string {
  const budget = limits.maxMatchContextChars;
  if (line.length <= budget) {
    return line;
  }
  const slack = Math.max(0, Math.floor((budget - length) / 2));
  const start = Math.max(0, offset - slack);
  const clipped = line.slice(start, start + budget);
  return truncateWellFormed(clipped, budget);
}

function matchesInLine(
  line: string,
  options: ScanOptions,
): readonly { offset: number }[] {
  const haystack = comparable(line, options.caseSensitive);
  const needle = comparable(options.query, options.caseSensitive);
  if (options.matchMode === "exact") {
    return haystack.trim() === needle.trim() ? [{ offset: 0 }] : [];
  }
  const found: { offset: number }[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    found.push({ offset: at });
    at = haystack.indexOf(needle, at + Math.max(1, needle.length));
  }
  return found;
}

/**
 * Scans the cached extraction for literal occurrences.
 *
 * A page whose text the engine could not trust contributes nothing and is
 * counted in `unsearchablePages`, so a caller can tell an absent match from an
 * unread page.
 */
export function scanLiteral(
  pages: readonly ExtractedPage[],
  options: ScanOptions,
): ScanResult {
  const matches: LiteralMatch[] = [];
  const startPage = options.from?.page ?? 1;
  const startOrdinal = options.from?.ordinal ?? 0;
  const pending = options.pending ?? new Set<number>();
  let searchedPages = 0;
  const unsearchablePages =
    (options.from?.unsearchableBehind ?? 0) +
    pages.filter(
      (page) => page.page >= startPage && isUnsearchable(page, pending),
    ).length;
  const stop = (position: ScanPosition): ScanResult => ({
    matches,
    searchedPages,
    unsearchablePages,
    next: resumeAt(pages, options, position),
  });

  for (const page of pages) {
    if (page.page < startPage) {
      continue;
    }
    if (pending.has(page.page)) {
      return stop({ page: page.page, ordinal: 0 });
    }
    if (page.needsOcr) {
      continue;
    }
    searchedPages += 1;
    let ordinal = 0;
    const lines = page.markdown.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      for (const hit of matchesInLine(line, options)) {
        const current = ordinal;
        ordinal += 1;
        if (page.page === startPage && current < startOrdinal) {
          continue;
        }
        if (matches.length >= options.maxResults) {
          return stop({ page: page.page, ordinal: current });
        }
        matches.push({
          page: page.page,
          line: index + 1,
          context: contextAround(line, hit.offset, options.query.length),
          ordinal: current,
        });
      }
    }
  }
  return { matches, searchedPages, unsearchablePages };
}
