import { describe, expect, it } from "vitest";
import {
  descriptionWeight,
  nameWeight,
  prefixMinimumLength,
  routeWeight,
  tagWeight,
  tokenize,
  ToolIndex,
  type SearchDocument,
} from "../src/search.js";

interface ReferenceDocument {
  readonly name: string;
  readonly terms: ReadonlyMap<string, number>;
  readonly length: number;
}

const k1 = 1.2;
const b = 0.75;

const ordinal = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function accumulate(
  terms: Map<string, number>,
  text: string | undefined,
  weight: number,
): void {
  for (const token of tokenize(text)) {
    terms.set(token, (terms.get(token) ?? 0) + weight);
  }
}

function frequency(document: ReferenceDocument, queryTerm: string): number {
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

class LinearReferenceIndex {
  private readonly documents: readonly ReferenceDocument[];
  private readonly averageLength: number;

  constructor(source: readonly SearchDocument[]) {
    this.documents = source.map((document) => {
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
      return { name: document.name, terms, length };
    });
    this.averageLength =
      this.documents.length === 0
        ? 0
        : this.documents.reduce((sum, document) => sum + document.length, 0) /
          this.documents.length;
  }

  search(query: string | undefined, limit: number): string[] {
    if (!(limit > 0)) {
      throw new RangeError("limit must be positive");
    }
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) {
      return this.documents
        .map((document) => document.name)
        .sort(ordinal)
        .slice(0, limit);
    }

    const documentFrequencies = new Map<string, number>();
    for (const term of queryTerms) {
      documentFrequencies.set(
        term,
        this.documents.filter((document) => frequency(document, term) > 0)
          .length,
      );
    }

    const scored: Array<{ readonly name: string; readonly score: number }> = [];
    for (const document of this.documents) {
      let score = 0;
      for (const term of queryTerms) {
        const tf = frequency(document, term);
        if (tf <= 0) {
          continue;
        }
        const df = documentFrequencies.get(term) ?? 0;
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
      .sort(
        (left, right) =>
          right.score - left.score || ordinal(left.name, right.name),
      )
      .slice(0, limit)
      .map((entry) => entry.name);
  }
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function syntheticDocuments(seed: number, count: number): SearchDocument[] {
  const next = random(seed);
  const nouns = [
    "order",
    "customer",
    "invoice",
    "payment",
    "shipment",
    "subscription",
    "sipariş",
    "çağrı",
  ] as const;
  const verbs = ["get", "list", "create", "update", "delete"] as const;
  return Array.from({ length: count }, (_, index) => {
    const noun = nouns[Math.floor(next() * nouns.length)] as string;
    const verb = verbs[Math.floor(next() * verbs.length)] as string;
    const unique = `resource${String(index).padStart(4, "0")}`;
    return {
      name: `${verb}_${noun}_${unique}`,
      description: `${verb} ${noun} records with status metadata ${unique}`,
      tags: index % 7 === 0 ? [noun, verb, "id"] : [noun, verb],
      route: `/v1/${noun}/${unique}`,
    };
  });
}

describe("ToolIndex inverted index", () => {
  it("matches the linear reference across deterministic catalogs", () => {
    const queries = [
      "",
      "id",
      "ord",
      "orders",
      "invoice",
      "customer status",
      "sipariş",
      "cagri",
      "çağrı",
      "resource0007",
      "missing",
    ];
    for (const seed of [1, 7, 42, 0x5eed]) {
      const documents = syntheticDocuments(seed, 250);
      const expected = new LinearReferenceIndex(documents);
      const actual = new ToolIndex(documents);
      expect(actual.count).toBe(documents.length);
      for (const query of queries) {
        for (const limit of [1, 20, documents.length]) {
          expect(
            actual.search(query, limit),
            `${seed}:${query}:${limit}`,
          ).toEqual(expected.search(query, limit));
        }
      }
    }
  });

  it("preserves empty catalogs and invalid limits", () => {
    const index = new ToolIndex([]);
    expect(index.count).toBe(0);
    expect(index.search("anything", 20)).toEqual([]);
    expect(index.search("", 20)).toEqual([]);
    expect(() => index.search("anything", 0)).toThrowError(
      new RangeError("limit must be positive"),
    );
  });

  it("sums every document term matching the same prefix", () => {
    const documents: SearchDocument[] = [
      {
        name: "order_ordering",
        description: "orders",
        tags: ["orderable"],
        route: "/orders",
      },
      {
        name: "order",
        description: "unrelated",
        route: "/other",
      },
    ];
    const expected = new LinearReferenceIndex(documents);
    const actual = new ToolIndex(documents);
    expect(actual.search("ord", 20)).toEqual(expected.search("ord", 20));
  });
});
