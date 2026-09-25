import { sanitizeToolDescription } from "@chat/contracts/integration/tool-description";

import type { CatalogTool } from "../connections/integration-tool.repository.ts";

export const MAX_SEARCH_RESULTS = 10;

export function summarizeRemote(entry: CatalogTool): string {
  return sanitizeToolDescription(entry.title, entry.description);
}

/**
 * Guard: search reads what the server wrote, not what the model is shown.
 * `summarizeRemote` bounds its output at a length that would drop the tail of a
 * long description, and a term that only appears there is still the reader's
 * best handle on the tool they are looking for.
 */
export function searchableRemote(entry: CatalogTool): string {
  return [
    entry.remoteName,
    entry.title,
    entry.description,
    entry.integrationName,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" ")
    .toLowerCase();
}

/**
 * The entries whose searchable text holds the most of the query's terms, best
 * first, at most `MAX_SEARCH_RESULTS` of them; an entry that holds none is left
 * out.
 *
 * @param entries what may be found
 * @param query the model's words, split on whitespace
 * @param textOf the lowercased text an entry is matched against
 * @returns the ranked hits
 */
export function rankByTerms<T>(
  entries: readonly T[],
  query: string,
  textOf: (entry: T) => string,
): T[] {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);

  return entries
    .map((entry) => {
      const text = textOf(entry);

      return {
        entry,
        hits: terms.filter((term) => text.includes(term)).length,
      };
    })
    .filter(({ hits }) => hits > 0)
    .sort((left, right) => right.hits - left.hits)
    .slice(0, MAX_SEARCH_RESULTS)
    .map(({ entry }) => entry);
}
