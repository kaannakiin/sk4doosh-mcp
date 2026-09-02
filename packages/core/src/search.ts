export interface SearchDocument {
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly route: string;
}

export const nameWeight = 3.0;
export const descriptionWeight = 1.5;
export const tagWeight = 1.0;
export const routeWeight = 1.0;
export const prefixMinimumLength = 3;

const k1 = 1.2;
const b = 0.75;

const letterOrDigit = /[\p{L}\p{N}]/u;
const upper = /\p{Lu}/u;
const lower = /\p{Ll}/u;

interface IndexedDocument {
  readonly name: string;
  readonly terms: Map<string, number>;
  readonly length: number;
}

function flush(tokens: string[], current: string): void {
  if (current.length < 2) {
    return;
  }
  const token =
    current.length > 3 && current.endsWith("s")
      ? current.slice(0, -1)
      : current;
  tokens.push(token);
}

export function tokenize(text: string | undefined): string[] {
  if (text === undefined || text.trim() === "") {
    return [];
  }
  const tokens: string[] = [];
  let current = "";
  for (let index = 0; index < text.length; index++) {
    const character = text[index] as string;
    if (!letterOrDigit.test(character)) {
      flush(tokens, current);
      current = "";
      continue;
    }
    const previous = index > 0 ? (text[index - 1] as string) : "";
    const next = index + 1 < text.length ? (text[index + 1] as string) : "";
    const boundary =
      previous !== "" &&
      upper.test(character) &&
      (lower.test(previous) ||
        (upper.test(previous) && next !== "" && lower.test(next)));
    if (boundary) {
      flush(tokens, current);
      current = "";
    }
    current += character.toLowerCase();
  }
  flush(tokens, current);
  return tokens;
}

function accumulate(
  terms: Map<string, number>,
  text: string | undefined,
  weight: number,
): void {
  for (const token of tokenize(text)) {
    terms.set(token, (terms.get(token) ?? 0) + weight);
  }
}

function frequency(document: IndexedDocument, queryTerm: string): number {
  if (queryTerm.length < prefixMinimumLength) {
    return document.terms.get(queryTerm) ?? 0;
  }
  let total = 0;
  for (const [term, value] of document.terms) {
    if (term.startsWith(queryTerm)) {
      total += value;
    }
  }
  return total;
}

const ordinal = (a: string, bb: string): number =>
  a < bb ? -1 : a > bb ? 1 : 0;

export class ToolIndex {
  private readonly documents: IndexedDocument[] = [];
  private readonly averageLength: number;

  constructor(documents: Iterable<SearchDocument>) {
    for (const document of documents) {
      const terms = new Map<string, number>();
      accumulate(terms, document.name, nameWeight);
      accumulate(terms, document.description, descriptionWeight);
      for (const tag of document.tags ?? []) {
        accumulate(terms, tag, tagWeight);
      }
      accumulate(terms, document.route, routeWeight);
      let length = 0;
      for (const value of terms.values()) {
        length += value;
      }
      this.documents.push({ name: document.name, terms, length });
    }
    this.averageLength =
      this.documents.length === 0
        ? 0
        : this.documents.reduce((sum, d) => sum + d.length, 0) /
          this.documents.length;
  }

  get count(): number {
    return this.documents.length;
  }

  search(query: string | undefined, limit: number): string[] {
    if (!(limit > 0)) {
      throw new RangeError("limit must be positive");
    }
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) {
      return this.documents
        .map((d) => d.name)
        .sort(ordinal)
        .slice(0, limit);
    }

    const matchingDocuments = new Map<string, number>();
    for (const term of queryTerms) {
      matchingDocuments.set(
        term,
        this.documents.filter((d) => frequency(d, term) > 0).length,
      );
    }

    const scored: Array<{ name: string; score: number }> = [];
    for (const document of this.documents) {
      let score = 0;
      for (const term of queryTerms) {
        const tf = frequency(document, term);
        if (tf <= 0) {
          continue;
        }
        const df = matchingDocuments.get(term) ?? 0;
        const idf = Math.log(
          1 + (this.documents.length - df + 0.5) / (df + 0.5),
        );
        const normalized =
          (tf * (k1 + 1)) /
          (tf + k1 * (1 - b + (b * document.length) / this.averageLength));
        score += idf * normalized;
      }
      if (score > 0) {
        scored.push({ name: document.name, score });
      }
    }

    return scored
      .sort((x, y) => y.score - x.score || ordinal(x.name, y.name))
      .slice(0, limit)
      .map((s) => s.name);
  }
}
