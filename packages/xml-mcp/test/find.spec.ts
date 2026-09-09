import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { coreLimits } from "@sk-mcp/file-core";
import { toolDefinitions } from "../src/tools.js";
import type { Fixtures } from "./fixtures/build.js";
import {
  bodyOf,
  bytesOf,
  createHarness,
  type Harness,
} from "./fixtures/harness.js";

let fixtures: Fixtures;
let harness: Harness;

interface Match {
  readonly nodeId: string;
  readonly matchKind: string;
  readonly snippet: string;
  readonly attribute?: { readonly localName: string };
}

interface Envelope {
  readonly matches: readonly Match[];
  readonly returnedCount: number;
  readonly scannedCount: number;
  readonly complete: boolean;
  readonly totalMatches?: number;
  readonly matchedSoFar?: number;
  readonly truncated: boolean;
  readonly truncationReason?: string;
  readonly nextCursor?: string;
}

async function find(args: Record<string, unknown>): Promise<Envelope> {
  const result = await harness.handlers.find_in_document(
    args as Parameters<Harness["handlers"]["find_in_document"]>[0],
  );
  return bodyOf(result) as unknown as Envelope;
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("the search schema", () => {
  it("rejects an empty query", () => {
    const parsed = toolDefinitions.find_in_document.inputSchema.safeParse({
      filePath: "a.xml",
      query: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("offers no regex match mode at all", () => {
    const parsed = toolDefinitions.find_in_document.inputSchema.safeParse({
      filePath: "a.xml",
      query: "a",
      matchMode: "regex",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("literal matching", () => {
  it("treats the query as text, never as a pattern", async () => {
    const page = await find({
      filePath: basename(fixtures.wide),
      query: "v.*",
    });
    expect(page.complete).toBe(true);
    expect(page.totalMatches).toBe(0);
    expect(page.matches).toStrictEqual([]);
  });

  it("matches a substring by default and the whole value on exact", async () => {
    const contains = await find({
      filePath: basename(fixtures.invoice),
      query: "10.5",
    });
    expect(contains.totalMatches).toBe(1);

    const exact = await find({
      filePath: basename(fixtures.invoice),
      query: "10.5",
      matchMode: "exact",
    });
    expect(exact.totalMatches).toBe(0);

    const whole = await find({
      filePath: basename(fixtures.invoice),
      query: "10.50",
      matchMode: "exact",
    });
    expect(whole.totalMatches).toBe(1);
  });

  it("stays case sensitive", async () => {
    const lower = await find({
      filePath: basename(fixtures.invoice),
      query: "true",
    });
    expect(lower.totalMatches).toBe(1);
    const upper = await find({
      filePath: basename(fixtures.invoice),
      query: "TRUE",
    });
    expect(upper.totalMatches).toBe(0);
  });
});

describe("the search surface", () => {
  it("separates a text hit from an attribute hit on the same element", async () => {
    const both = await find({
      filePath: basename(fixtures.wide),
      query: "7",
      searchIn: "both",
    });
    const kinds = both.matches.map((match) => match.matchKind);
    expect(kinds).toContain("text");
    expect(kinds).toContain("attribute");
    const attribute = both.matches.find(
      (match) => match.matchKind === "attribute",
    );
    expect(attribute?.attribute?.localName).toBe("k");
  });

  it("searches only text unless attributes are asked for", async () => {
    const text = await find({ filePath: basename(fixtures.wide), query: "7" });
    expect(text.matches.every((match) => match.matchKind === "text")).toBe(
      true,
    );

    const attributes = await find({
      filePath: basename(fixtures.wide),
      query: "7",
      searchIn: "attributes",
    });
    expect(
      attributes.matches.every((match) => match.matchKind === "attribute"),
    ).toBe(true);
  });

  it("honours a scope address", async () => {
    const scoped = await find({
      filePath: basename(fixtures.namespaceTraps),
      query: "one",
      scopeAddress: [
        { namespaceUri: "urn:default", localName: "root" },
        { namespaceUri: "urn:default", localName: "child" },
      ],
    });
    expect(scoped.totalMatches).toBe(1);
    expect(scoped.matches[0]?.snippet).toBe("beta-one");
  });
});

describe("scan completeness", () => {
  it("gives an exact total only when the scan finished", async () => {
    const whole = await find({ filePath: basename(fixtures.wide), query: "v" });
    expect(whole.complete).toBe(true);
    expect(whole.totalMatches).toBe(40);
    expect(whole.matchedSoFar).toBeUndefined();
  });

  it("reports matchedSoFar instead of a total when it stops early", async () => {
    const capped = await find({
      filePath: basename(fixtures.wide),
      query: "v",
      maxResults: 5,
    });
    expect(capped.complete).toBe(false);
    expect(capped.totalMatches).toBeUndefined();
    expect(capped.matchedSoFar).toBe(5);
    expect(capped.truncationReason).toBe("maxResults");
    expect(capped.scannedCount).toBeGreaterThan(0);
    expect(capped.nextCursor).toBeDefined();
  });

  it("merges its pages without repeating a match", async () => {
    const whole = await find({ filePath: basename(fixtures.wide), query: "v" });
    const seen: string[] = [];
    let page = await find({
      filePath: basename(fixtures.wide),
      query: "v",
      maxResults: 6,
    });
    for (;;) {
      for (const match of page.matches) seen.push(match.nodeId);
      if (page.nextCursor === undefined) break;
      page = await find({
        filePath: basename(fixtures.wide),
        query: "v",
        maxResults: 6,
        cursor: page.nextCursor,
      });
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toStrictEqual(whole.matches.map((match) => match.nodeId));
  });

  it("keeps a search response inside the envelope", async () => {
    const result = await harness.handlers.find_in_document({
      filePath: basename(fixtures.heavyPages),
      query: "p",
      searchIn: "attributes",
      maxResults: 200,
    });
    expect(bytesOf(result)).toBeLessThanOrEqual(coreLimits.maxPayloadBytes);
  });
});
