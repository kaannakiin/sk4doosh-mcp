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
const nonSpacingMark = /\p{Mn}/gu;
const upper = /\p{Lu}/u;
const lower = /\p{Ll}/u;

interface IndexedDocument {
  readonly name: string;
  readonly length: number;
}

interface MutablePostingList {
  readonly documentIds: number[];
  readonly frequencies: number[];
}

export function foldToken(text: string): string {
  return text
    .normalize("NFD")
    .replace(nonSpacingMark, "")
    .toLowerCase()
    .normalize("NFC");
}

function flush(tokens: string[], current: string): void {
  const folded = foldToken(current);
  if (folded.length < 2) {
    return;
  }
  const token =
    folded.length > 3 && folded.endsWith("s") ? folded.slice(0, -1) : folded;
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
    current += character;
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

const ordinal = (a: string, bb: string): number =>
  a < bb ? -1 : a > bb ? 1 : 0;

function lowerBound(values: readonly string[], target: string): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const value = values[middle] as string;
    if (value < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function addPostingFrequencies(
  totals: Float64Array,
  touchedDocumentIds: number[],
  postingDocumentIds: Uint32Array,
  postingFrequencies: Float64Array,
  start: number,
  end: number,
): void {
  for (let index = start; index < end; index++) {
    const documentId = postingDocumentIds[index] as number;
    const frequency = postingFrequencies[index] as number;
    if (totals[documentId] === 0) {
      touchedDocumentIds.push(documentId);
    }
    totals[documentId] = (totals[documentId] as number) + frequency;
  }
}

export class ToolIndex {
  private readonly documents: IndexedDocument[] = [];
  private readonly averageLength: number;
  private readonly ordinalDocumentIds: Uint32Array;
  private readonly ordinalRanks: Uint32Array;
  private readonly postingDocumentIds: Uint32Array;
  private readonly postingFrequencies: Float64Array;
  private readonly postingOffsets: Uint32Array;
  private readonly vocabulary: readonly string[];

  constructor(documents: Iterable<SearchDocument>) {
    const mutablePostings = new Map<string, MutablePostingList>();
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
      const documentId = this.documents.length;
      this.documents.push({ name: document.name, length });
      for (const [term, frequency] of terms) {
        let posting = mutablePostings.get(term);
        if (posting === undefined) {
          posting = { documentIds: [], frequencies: [] };
          mutablePostings.set(term, posting);
        }
        posting.documentIds.push(documentId);
        posting.frequencies.push(frequency);
      }
    }
    this.averageLength =
      this.documents.length === 0
        ? 0
        : this.documents.reduce((sum, d) => sum + d.length, 0) /
          this.documents.length;
    const ordinalDocumentIds = this.documents.map(
      (_, documentId) => documentId,
    );
    ordinalDocumentIds.sort((left, right) =>
      ordinal(
        (this.documents[left] as IndexedDocument).name,
        (this.documents[right] as IndexedDocument).name,
      ),
    );
    this.ordinalDocumentIds = Uint32Array.from(ordinalDocumentIds);
    this.ordinalRanks = new Uint32Array(this.documents.length);
    for (const [rank, documentId] of ordinalDocumentIds.entries()) {
      this.ordinalRanks[documentId] = rank;
    }
    this.vocabulary = [...mutablePostings.keys()].sort(ordinal);
    let postingCount = 0;
    for (const term of this.vocabulary) {
      const posting = mutablePostings.get(term) as MutablePostingList;
      postingCount += posting.documentIds.length;
    }
    this.postingDocumentIds = new Uint32Array(postingCount);
    this.postingFrequencies = new Float64Array(postingCount);
    this.postingOffsets = new Uint32Array(this.vocabulary.length + 1);
    let postingIndex = 0;
    for (const [vocabularyIndex, term] of this.vocabulary.entries()) {
      this.postingOffsets[vocabularyIndex] = postingIndex;
      const posting = mutablePostings.get(term) as MutablePostingList;
      for (let index = 0; index < posting.documentIds.length; index++) {
        this.postingDocumentIds[postingIndex] = posting.documentIds[
          index
        ] as number;
        this.postingFrequencies[postingIndex] = posting.frequencies[
          index
        ] as number;
        postingIndex++;
      }
    }
    this.postingOffsets[this.vocabulary.length] = postingIndex;
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
      const names: string[] = [];
      const count = Math.min(limit, this.ordinalDocumentIds.length);
      for (let index = 0; index < count; index++) {
        const documentId = this.ordinalDocumentIds[index] as number;
        names.push((this.documents[documentId] as IndexedDocument).name);
      }
      return names;
    }

    const frequencies = new Float64Array(this.documents.length);
    const scores = new Float64Array(this.documents.length);
    const scoredDocumentIds: number[] = [];
    for (const term of queryTerms) {
      const matchingDocumentIds: number[] = [];
      if (term.length < prefixMinimumLength) {
        const vocabularyIndex = lowerBound(this.vocabulary, term);
        if (this.vocabulary[vocabularyIndex] === term) {
          addPostingFrequencies(
            frequencies,
            matchingDocumentIds,
            this.postingDocumentIds,
            this.postingFrequencies,
            this.postingOffsets[vocabularyIndex] as number,
            this.postingOffsets[vocabularyIndex + 1] as number,
          );
        }
      } else {
        for (
          let index = lowerBound(this.vocabulary, term);
          index < this.vocabulary.length;
          index++
        ) {
          const candidate = this.vocabulary[index] as string;
          if (!candidate.startsWith(term)) {
            break;
          }
          addPostingFrequencies(
            frequencies,
            matchingDocumentIds,
            this.postingDocumentIds,
            this.postingFrequencies,
            this.postingOffsets[index] as number,
            this.postingOffsets[index + 1] as number,
          );
        }
      }
      const documentFrequency = matchingDocumentIds.length;
      if (documentFrequency === 0) {
        continue;
      }
      const idf = Math.log(
        1 +
          (this.documents.length - documentFrequency + 0.5) /
            (documentFrequency + 0.5),
      );
      for (const documentId of matchingDocumentIds) {
        const tf = frequencies[documentId] as number;
        const document = this.documents[documentId] as IndexedDocument;
        const normalized =
          (tf * (k1 + 1)) /
          (tf + k1 * (1 - b + (b * document.length) / this.averageLength));
        if (scores[documentId] === 0) {
          scoredDocumentIds.push(documentId);
        }
        scores[documentId] = (scores[documentId] as number) + idf * normalized;
        frequencies[documentId] = 0;
      }
    }

    return scoredDocumentIds
      .sort((left, right) => {
        const scoreDifference =
          (scores[right] as number) - (scores[left] as number);
        if (scoreDifference !== 0) {
          return scoreDifference;
        }
        return (
          (this.ordinalRanks[left] as number) -
          (this.ordinalRanks[right] as number)
        );
      })
      .slice(0, limit)
      .map(
        (documentId) => (this.documents[documentId] as IndexedDocument).name,
      );
  }
}
