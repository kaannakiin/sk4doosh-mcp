import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ParseOption } from "libxml2-wasm";
import { describe, expect, it } from "vitest";
import { limits, workerCapacityFor } from "../src/limits.js";
import { forbiddenParseOptions, HARDENED } from "../src/parse-policy.js";

const here = dirname(fileURLToPath(import.meta.url));
const workerEntry = resolve(here, "../dist/xml-worker.js");

const hostOnly = ["@sk-mcp/", "zod", "@modelcontextprotocol"];
const neverInWorker = ["libxml2-wasm/lib/nodejs"];
const providerSymbols = [
  "xmlRegisterInputProvider",
  "xmlRegisterFsInputProviders",
  "XmlInputProvider",
];

function walkWorker(
  entry: string,
  inspect: (file: string, source: string) => void,
): void {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      return;
    }
    inspect(file, source);
    for (const match of source.matchAll(/from\s+"([^"]+)"/gu)) {
      const specifier = match[1];
      if (specifier !== undefined && specifier.startsWith("."))
        visit(resolve(dirname(file), specifier));
    }
  };
  visit(entry);
}

function moduleGraph(entry: string): readonly string[] {
  const external: string[] = [];
  walkWorker(entry, (file, source) => {
    for (const match of source.matchAll(/from\s+"([^"]+)"/gu)) {
      const specifier = match[1];
      if (specifier === undefined || specifier.startsWith(".")) continue;
      if (
        hostOnly.some((name) => specifier.startsWith(name)) ||
        neverInWorker.some((name) => specifier.startsWith(name))
      ) {
        external.push(`${file} -> ${specifier}`);
      }
    }
  });
  return external;
}

function providerMentions(entry: string): readonly string[] {
  const found: string[] = [];
  walkWorker(entry, (file, source) => {
    for (const symbol of providerSymbols) {
      if (source.includes(symbol)) found.push(`${file} -> ${symbol}`);
    }
  });
  return found;
}

describe("the parse policy", () => {
  it("uses exactly the three hardened options", () => {
    expect(HARDENED).toBe(
      ParseOption.XML_PARSE_NO_XXE |
        ParseOption.XML_PARSE_NONET |
        ParseOption.XML_PARSE_NO_SYS_CATALOG,
    );
  });

  it("leaves every option that would lose content switched off", () => {
    for (const name of forbiddenParseOptions) {
      const flag = ParseOption[name as keyof typeof ParseOption];
      expect(typeof flag).toBe("number");
      expect(HARDENED & Number(flag)).toBe(0);
    }
  });

  it("keeps whitespace and cdata options off, since either would erase content", () => {
    expect(HARDENED & ParseOption.XML_PARSE_NOBLANKS).toBe(0);
    expect(HARDENED & ParseOption.XML_PARSE_NOCDATA).toBe(0);
  });
});

describe("the cache size knob", () => {
  it("derives a worker capacity that always satisfies W >= 2S-1", () => {
    for (const documentCacheSize of [1, 2, 4, 8, 32, 64]) {
      expect(workerCapacityFor(documentCacheSize)).toBeGreaterThanOrEqual(
        2 * documentCacheSize - 1,
      );
    }
  });

  it("leaves the shipped default where it already was", () => {
    expect(limits.documentCacheSize).toBe(4);
    expect(limits.workerCacheEntries).toBe(8);
  });
});

describe("the tier knob", () => {
  it("never lets a chunk outgrow a resident document", () => {
    expect(limits.maxChunkBytes).toBeLessThanOrEqual(limits.residentMaxBytes);
  });

  it("keeps chunked peak DOM at or below the resident peak", () => {
    expect(limits.maxLiveChunkDoms * limits.maxChunkBytes).toBeLessThanOrEqual(
      limits.residentMaxBytes,
    );
  });

  it("budgets a chunk no longer than a whole document", () => {
    expect(limits.maxChunkParseMs).toBeLessThanOrEqual(limits.maxParseMs);
  });

  it("derives the accepted ceiling from the knob", () => {
    expect(limits.maxXmlBytes).toBeGreaterThanOrEqual(limits.residentMaxBytes);
    expect(limits.maxXmlBytes).toBeLessThanOrEqual(limits.maxFileBytes);
  });
});

describe("the worker boundary", () => {
  it("builds a worker graph that reaches no host dependency", () => {
    expect(moduleGraph(workerEntry)).toStrictEqual([]);
  });

  it("registers no libxml2 input provider anywhere it can reach", () => {
    expect(providerMentions(workerEntry)).toStrictEqual([]);
  });
});
