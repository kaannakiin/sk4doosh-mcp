import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { coreLimits } from "@sk-mcp/file-core";
import type { Fixtures } from "./fixtures/build.js";
import { bodyOf, bytesOf, createHarness, type Harness } from "./fixtures/harness.js";

let fixtures: Fixtures;
let harness: Harness;

interface Record_ {
  readonly nodeId: string;
  readonly parentId?: string;
  readonly childIndex: number;
  readonly depth: number;
  readonly kind: string;
  readonly localName?: string;
  readonly value?: string;
  readonly childrenOmitted?: true;
}

interface Envelope {
  readonly records: readonly Record_[];
  readonly context?: readonly { readonly nodeId: string }[];
  readonly returnedCount: number;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly truncationReason?: string;
  readonly nextCursor?: string;
  readonly error?: string;
  readonly message?: string;
}

async function read(args: Record<string, unknown>): Promise<Envelope> {
  const result = await harness.handlers.read_node(
    args as Parameters<Harness["handlers"]["read_node"]>[0],
  );
  return bodyOf(result) as unknown as Envelope;
}

async function readRaw(args: Record<string, unknown>) {
  return harness.handlers.read_node(
    args as Parameters<Harness["handlers"]["read_node"]>[0],
  );
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("value fidelity", () => {
  it("keeps leading zeros, decimals and large integers as written", async () => {
    const page = await read({
      filePath: basename(fixtures.invoice),
      maxNodes: 200,
    });
    const values = page.records
      .filter((record) => record.kind === "text")
      .map((record) => record.value);
    expect(values).toContain("007");
    expect(values).toContain("0080");
    expect(values).toContain("10.50");
    expect(values).toContain("1234567890123456789");
    expect(values).toContain("false");
    expect(values).toContain("0");
  });

  it("separates an empty element from one holding an empty text node", async () => {
    const page = await read({
      filePath: basename(fixtures.invoice),
      maxNodes: 200,
    });
    const notes = page.records.filter(
      (record) => record.kind === "element" && record.localName === "Note",
    );
    expect(notes).toHaveLength(2);
    const childrenOf = (nodeId: string): readonly Record_[] =>
      page.records.filter((record) => record.parentId === nodeId);
    expect(childrenOf(notes[0]?.nodeId ?? "")).toHaveLength(0);
    expect(childrenOf(notes[1]?.nodeId ?? "")).toHaveLength(0);
  });

  it("reports a missing element as absent rather than as an empty value", async () => {
    const page = await read({
      filePath: basename(fixtures.invoice),
      maxNodes: 200,
    });
    const names = page.records
      .filter((record) => record.kind === "element")
      .map((record) => record.localName);
    expect(names).not.toContain("Discount");
  });
});

describe("page merging", () => {
  it("rebuilds the single-page result exactly, with no repeat and no loss", async () => {
    const whole = await read({ filePath: basename(fixtures.wide), maxNodes: 200 });
    expect(whole.complete).toBe(true);

    const merged: Record_[] = [];
    const seen = new Set<string>();
    let page = await read({ filePath: basename(fixtures.wide), maxNodes: 7 });
    for (;;) {
      for (const record of page.records) {
        expect(seen.has(record.nodeId)).toBe(false);
        seen.add(record.nodeId);
        merged.push(record);
      }
      if (page.nextCursor === undefined) break;
      page = await read({
        filePath: basename(fixtures.wide),
        maxNodes: 7,
        cursor: page.nextCursor,
      });
    }
    expect(merged).toStrictEqual(whole.records);
  });

  it("keeps ancestor context out of returnedCount and out of the merge", async () => {
    const first = await read({ filePath: basename(fixtures.wide), maxNodes: 3 });
    const second = await read({
      filePath: basename(fixtures.wide),
      maxNodes: 3,
      cursor: first.nextCursor,
    });
    expect(second.context?.map((entry) => entry.nodeId)).toStrictEqual(["1"]);
    expect(second.returnedCount).toBe(second.records.length);
    const ids = new Set(second.records.map((record) => record.nodeId));
    expect(ids.has("1")).toBe(false);
  });

  it("advances by at least one record on every page", async () => {
    let page = await read({ filePath: basename(fixtures.wide), maxNodes: 1 });
    let pages = 0;
    for (;;) {
      expect(page.records.length).toBeGreaterThanOrEqual(1);
      pages += 1;
      if (page.nextCursor === undefined || pages > 200) break;
      page = await read({
        filePath: basename(fixtures.wide),
        maxNodes: 1,
        cursor: page.nextCursor,
      });
    }
    expect(pages).toBeLessThanOrEqual(200);
  });
});

describe("the depth limit", () => {
  it("marks the held-back element and needs a separate call to go deeper", async () => {
    const shallow = await read({
      filePath: basename(fixtures.deep),
      maxDepth: 2,
      maxNodes: 200,
    });
    expect(shallow.complete).toBe(true);
    expect(shallow.nextCursor).toBeUndefined();
    const boundary = shallow.records.filter(
      (record) => record.childrenOmitted === true,
    );
    expect(boundary).toHaveLength(1);
    expect(boundary[0]?.depth).toBe(2);

    const deeper = await read({
      filePath: basename(fixtures.deep),
      address: [
        { namespaceUri: "", localName: "d" },
        { namespaceUri: "", localName: "n" },
        { namespaceUri: "", localName: "n" },
      ],
      maxDepth: 2,
      maxNodes: 200,
    });
    expect(deeper.records.length).toBeGreaterThan(1);
  });
});

describe("the response budget", () => {
  it("stops a page on bytes and points the cursor at the record it withheld", async () => {
    const result = await readRaw({
      filePath: basename(fixtures.heavyPages),
      maxNodes: 200,
    });
    const page = bodyOf(result) as unknown as Envelope;
    expect(bytesOf(result)).toBeLessThanOrEqual(coreLimits.maxPayloadBytes);
    expect(page.truncated).toBe(true);
    expect(page.truncationReason).toBe("maxPayloadBytes");
    expect(page.nextCursor).toBeDefined();

    const next = await read({
      filePath: basename(fixtures.heavyPages),
      maxNodes: 200,
      cursor: page.nextCursor,
    });
    const first = page.records.map((record) => record.nodeId);
    const second = next.records.map((record) => record.nodeId);
    expect(second.some((nodeId) => first.includes(nodeId))).toBe(false);
  });

  it("refuses with resource_limit when the very first record cannot fit", async () => {
    const result = await readRaw({
      filePath: basename(fixtures.oversizedNode),
      maxNodes: 200,
    });
    expect(result.isError).toBe(true);
    expect(bytesOf(result)).toBeLessThanOrEqual(coreLimits.maxPayloadBytes);
    const body = bodyOf(result);
    expect(body["error"]).toBe("resource_limit");
  });

  it("keeps every response under the envelope, errors included", async () => {
    for (const args of [
      { filePath: basename(fixtures.wide), maxNodes: 200 },
      { filePath: basename(fixtures.heavyPages), maxNodes: 200 },
      { filePath: basename(fixtures.oversizedNode), maxNodes: 200 },
      { filePath: basename(fixtures.malformed) },
      { filePath: "missing.xml" },
    ]) {
      const result = await readRaw(args);
      expect(bytesOf(result)).toBeLessThanOrEqual(coreLimits.maxPayloadBytes);
    }
  });

  it("leaks neither an absolute path nor a stack trace", async () => {
    const result = await readRaw({ filePath: basename(fixtures.malformed) });
    const body = bodyOf(result);
    const text = JSON.stringify(body);
    expect(text).not.toContain(fixtures.root);
    expect(text).not.toContain("    at ");
  });
});
