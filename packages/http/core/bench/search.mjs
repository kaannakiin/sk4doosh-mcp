import { spawnSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import {
  descriptionWeight,
  nameWeight,
  prefixMinimumLength,
  routeWeight,
  tagWeight,
  tokenize,
  ToolIndex,
} from "../dist/search.js";

const algorithms = ["linear", "trigram", "posting"];
const profiles = ["crud", "diverse"];
const defaultSizes = [100, 1_000, 10_000, 100_000];
const quickSizes = [100, 1_000, 10_000];
const k1 = 1.2;
const b = 0.75;
const textEncoder = new TextEncoder();

const ordinal = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function accumulate(terms, text, weight) {
  for (const token of tokenize(text)) {
    terms.set(token, (terms.get(token) ?? 0) + weight);
  }
}

function documentTerms(document) {
  const terms = new Map();
  accumulate(terms, document.name, nameWeight);
  accumulate(terms, document.description, descriptionWeight);
  for (const tag of document.tags ?? []) {
    accumulate(terms, tag, tagWeight);
  }
  accumulate(terms, document.route, routeWeight);
  return terms;
}

function frequency(document, queryTerm) {
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

function indexedDocuments(source) {
  let totalLength = 0;
  const documents = source.map((document) => {
    const terms = documentTerms(document);
    let length = 0;
    for (const value of terms.values()) {
      length += value;
    }
    totalLength += length;
    return { name: document.name, terms, length };
  });
  return {
    documents,
    averageLength: documents.length === 0 ? 0 : totalLength / documents.length,
  };
}

function scoreDocuments(documents, averageLength, queryTerms, candidatesFor) {
  const scores = new Map();
  for (const term of queryTerms) {
    const frequencies = new Map();
    for (const documentId of candidatesFor(term)) {
      const document = documents[documentId];
      const tf = frequency(document, term);
      if (tf > 0) {
        frequencies.set(documentId, tf);
      }
    }
    const df = frequencies.size;
    if (df === 0) {
      continue;
    }
    const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
    for (const [documentId, tf] of frequencies) {
      const document = documents[documentId];
      const normalized =
        (tf * (k1 + 1)) /
        (tf + k1 * (1 - b + (b * document.length) / averageLength));
      scores.set(documentId, (scores.get(documentId) ?? 0) + idf * normalized);
    }
  }
  return scores;
}

function finish(documents, scores, limit) {
  return [...scores]
    .map(([documentId, score]) => ({
      name: documents[documentId].name,
      score,
    }))
    .sort(
      (left, right) =>
        right.score - left.score || ordinal(left.name, right.name),
    )
    .slice(0, limit)
    .map((entry) => entry.name);
}

function listDocuments(documents, limit) {
  return documents
    .map((document) => document.name)
    .sort(ordinal)
    .slice(0, limit);
}

class LinearIndex {
  constructor(source) {
    const indexed = indexedDocuments(source);
    this.documents = indexed.documents;
    this.averageLength = indexed.averageLength;
  }

  search(query, limit) {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) {
      return listDocuments(this.documents, limit);
    }
    const documentFrequencies = new Map();
    for (const term of queryTerms) {
      let matches = 0;
      for (const document of this.documents) {
        if (frequency(document, term) > 0) {
          matches++;
        }
      }
      documentFrequencies.set(term, matches);
    }
    const scores = new Map();
    for (const [documentId, document] of this.documents.entries()) {
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
        scores.set(documentId, score);
      }
    }
    return finish(this.documents, scores, limit);
  }
}

function trigramHash(first, second, third) {
  return (first << 16) | (second << 8) | third;
}

function trigrams(text) {
  const bytes = textEncoder.encode(text);
  const result = new Set();
  for (let index = 0; index + 2 < bytes.length; index++) {
    result.add(trigramHash(bytes[index], bytes[index + 1], bytes[index + 2]));
  }
  return [...result];
}

function intersectSorted(left, right) {
  const result = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftValue = left[leftIndex];
    const rightValue = right[rightIndex];
    if (leftValue === rightValue) {
      result.push(leftValue);
      leftIndex++;
      rightIndex++;
    } else if (leftValue < rightValue) {
      leftIndex++;
    } else {
      rightIndex++;
    }
  }
  return result;
}

class TrigramCandidateIndex {
  constructor(source) {
    const indexed = indexedDocuments(source);
    this.documents = indexed.documents;
    this.averageLength = indexed.averageLength;
    this.allDocumentIds = this.documents.map((_, index) => index);
    this.postings = new Map();
    for (const [documentId, document] of this.documents.entries()) {
      const documentTrigrams = new Set();
      for (const term of document.terms.keys()) {
        for (const trigram of trigrams(term)) {
          documentTrigrams.add(trigram);
        }
      }
      for (const trigram of documentTrigrams) {
        let posting = this.postings.get(trigram);
        if (posting === undefined) {
          posting = [];
          this.postings.set(trigram, posting);
        }
        posting.push(documentId);
      }
    }
  }

  candidates(term) {
    if (term.length < prefixMinimumLength) {
      return this.allDocumentIds;
    }
    const lists = trigrams(term).map(
      (trigram) => this.postings.get(trigram) ?? [],
    );
    if (lists.length === 0) {
      return this.allDocumentIds;
    }
    lists.sort((left, right) => left.length - right.length);
    let candidates = lists[0];
    for (
      let index = 1;
      index < lists.length && candidates.length > 0;
      index++
    ) {
      candidates = intersectSorted(candidates, lists[index]);
    }
    return candidates;
  }

  search(query, limit) {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) {
      return listDocuments(this.documents, limit);
    }
    const scores = scoreDocuments(
      this.documents,
      this.averageLength,
      queryTerms,
      (term) => this.candidates(term),
    );
    return finish(this.documents, scores, limit);
  }
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function randomWord(next, length) {
  let result = "";
  for (let index = 0; index < length; index++) {
    result += String.fromCharCode(97 + Math.floor(next() * 26));
  }
  return result;
}

function syntheticDocuments(profile, count) {
  const next = random(0x5eed);
  const nouns = [
    "order",
    "customer",
    "invoice",
    "payment",
    "shipment",
    "product",
    "warehouse",
    "report",
    "profile",
    "notification",
    "subscription",
    "audit",
    "permission",
    "inventory",
    "account",
    "address",
  ];
  const verbs = [
    "get",
    "list",
    "create",
    "update",
    "delete",
    "search",
    "export",
    "approve",
  ];
  return Array.from({ length: count }, (_, index) => {
    const noun = nouns[index % nouns.length];
    const verb = verbs[(index * 7) % verbs.length];
    const unique = `resource${String(index).padStart(6, "0")}`;
    const cohort = `cohort${String(index % 1_000).padStart(3, "0")}`;
    const extra =
      profile === "diverse"
        ? `${randomWord(next, 10)} ${randomWord(next, 12)} ${randomWord(next, 14)}`
        : "tenant pagination detailed metadata";
    return {
      name: `${verb}_${noun}_${unique}`,
      description: `${verb} ${noun} records with status ${extra}`,
      tags:
        index % 10 === 0 ? [noun, verb, cohort, "id"] : [noun, verb, cohort],
      route: `/v1/${noun}/${unique}`,
    };
  });
}

const queries = [
  { name: "empty", value: "" },
  { name: "zero", value: "zzzzmissing" },
  { name: "short_exact_10pct", value: "id" },
  { name: "broad_prefix_100pct", value: "sta" },
  { name: "prefix_10pct", value: "cohort0" },
  { name: "prefix_1pct", value: "cohort00" },
  { name: "prefix_0_1pct", value: "cohort007" },
  { name: "selective_noun", value: "invoice" },
  { name: "mixed_two_term", value: "invoice status" },
];

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(Math.ceil(sorted.length * fraction) - 1, sorted.length - 1)
  ];
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function createIndex(name, documents) {
  if (name === "linear") return new LinearIndex(documents);
  if (name === "trigram") return new TrigramCandidateIndex(documents);
  if (name === "posting") return new ToolIndex(documents);
  throw new Error(`Unknown algorithm: ${name}`);
}

function worker(name, profile, size) {
  const source = syntheticDocuments(profile, size);
  globalThis.gc?.();
  const memoryBefore = process.memoryUsage();
  const buildStarted = performance.now();
  const index = createIndex(name, source);
  const buildMs = performance.now() - buildStarted;
  globalThis.gc?.();
  const memoryAfter = process.memoryUsage();
  const heapBytes = Math.max(memoryAfter.heapUsed - memoryBefore.heapUsed, 0);
  const arrayBufferBytes = Math.max(
    memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
    0,
  );
  const retainedBytes = heapBytes + arrayBufferBytes;
  const iterations = size >= 100_000 ? 5 : size >= 10_000 ? 15 : 40;
  const limits = [...new Set([Math.min(50, size), size])];
  const measurements = [];
  for (const query of queries) {
    for (const limit of limits) {
      const result = index.search(query.value, limit);
      for (let warmup = 0; warmup < 5; warmup++) {
        index.search(query.value, limit);
      }
      const samples = [];
      for (let iteration = 0; iteration < iterations; iteration++) {
        const started = performance.now();
        index.search(query.value, limit);
        samples.push(performance.now() - started);
      }
      const p50 = percentile(samples, 0.5);
      measurements.push({
        query: query.name,
        limit: limit === size ? "all" : limit,
        digest: digest(result),
        resultCount: result.length,
        p50Ms: p50,
        p95Ms: percentile(samples, 0.95),
        operationsPerSecond: p50 === 0 ? null : 1_000 / p50,
      });
    }
  }
  return {
    name,
    profile,
    size,
    buildMs,
    heapBytes,
    arrayBufferBytes,
    retainedBytes,
    measurements,
  };
}

function runChild(name, profile, size) {
  const result = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      fileURLToPath(import.meta.url),
      "--worker",
      name,
      profile,
      String(size),
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr || `Worker ${name}/${profile}/${size} failed`,
    );
  }
  return JSON.parse(result.stdout);
}

function assertParity(results) {
  const references = new Map();
  for (const result of results) {
    for (const measurement of result.measurements) {
      const key = `${result.profile}:${result.size}:${measurement.query}:${measurement.limit}`;
      if (result.name === "linear") {
        references.set(key, measurement.digest);
      } else if (references.get(key) !== measurement.digest) {
        throw new Error(`Result mismatch for ${result.name}:${key}`);
      }
    }
  }
}

function round(value) {
  return Number(value.toFixed(3));
}

function humanSummary(results) {
  console.log("\nBuild and retained index memory");
  console.table(
    results.map((result) => ({
      profile: result.profile,
      endpoints: result.size,
      algorithm: result.name,
      buildMs: round(result.buildMs),
      heapMiB: round(result.heapBytes / 1024 / 1024),
      buffersMiB: round(result.arrayBufferBytes / 1024 / 1024),
      retainedMiB: round(result.retainedBytes / 1024 / 1024),
    })),
  );
  console.log("\nRepresentative full-result queries");
  console.table(
    results.flatMap((result) =>
      result.measurements
        .filter(
          (measurement) =>
            measurement.limit === "all" &&
            ["prefix_0_1pct", "broad_prefix_100pct", "mixed_two_term"].includes(
              measurement.query,
            ),
        )
        .map((measurement) => ({
          profile: result.profile,
          endpoints: result.size,
          algorithm: result.name,
          query: measurement.query,
          p50Ms: round(measurement.p50Ms),
          p95Ms: round(measurement.p95Ms),
          results: measurement.resultCount,
        })),
    ),
  );
}

if (process.argv[2] === "--worker") {
  const [, , , name, profile, rawSize] = process.argv;
  process.stdout.write(JSON.stringify(worker(name, profile, Number(rawSize))));
} else {
  const quick = process.argv.includes("--quick");
  const sizeArgument = process.argv.find((value) =>
    value.startsWith("--size="),
  );
  const profileArgument = process.argv.find((value) =>
    value.startsWith("--profile="),
  );
  const sizes =
    sizeArgument === undefined
      ? quick
        ? quickSizes
        : defaultSizes
      : [Number(sizeArgument.slice("--size=".length))];
  const selectedProfiles =
    profileArgument === undefined
      ? quick
        ? [profiles[0]]
        : profiles
      : [profileArgument.slice("--profile=".length)];
  const results = [];
  for (const profile of selectedProfiles) {
    for (const size of sizes) {
      for (const algorithm of algorithms) {
        results.push(runChild(algorithm, profile, size));
      }
    }
  }
  assertParity(results);
  humanSummary(results);
  if (!process.argv.includes("--summary-only")) {
    console.log("\nJSON");
    console.log(
      JSON.stringify(
        {
          environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
          },
          quick,
          results,
        },
        null,
        2,
      ),
    );
  }
}
