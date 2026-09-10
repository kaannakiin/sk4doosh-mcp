import { basename } from "node:path";
import { modeFor } from "@sk-mcp/file-core";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { modePolicy } from "../src/limits.js";
import type { Fixtures } from "./fixtures/build.js";
import { bodyOf, createHarness, type Harness } from "./fixtures/harness.js";

let fixtures: Fixtures;
let harness: Harness;

const catalogue = {
  ancestors: [{ namespaceUri: "", localName: "catalogue" }],
  name: { namespaceUri: "", localName: "entry" },
};

const codeColumn = {
  label: "code",
  value: { from: "attribute", namespaceUri: "", localName: "code" },
};

function argsFor(filePath: string): Record<string, Record<string, unknown>> {
  return {
    list_documents: { maxResults: 50 },
    describe_document: { filePath },
    read_node: { filePath, maxNodes: 5 },
    find_in_document: { filePath, query: "entry" },
    select_xpath: { filePath, xpath: "//*" },
    project_records: {
      filePath,
      itemAddress: catalogue,
      columns: [codeColumn],
    },
    aggregate_document: {
      filePath,
      itemAddress: catalogue,
      columns: [codeColumn],
      metrics: [{ fn: "count" }],
    },
  };
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("the declared tier", () => {
  it("covers every registered tool, so a new one cannot skip the check", () => {
    expect(Object.keys(argsFor("x")).sort()).toStrictEqual(
      Object.keys(harness.handlers).sort(),
    );
  });

  it("rides on every success envelope", async () => {
    const filePath = basename(fixtures.records);
    for (const [tool, args] of Object.entries(argsFor(filePath))) {
      if (tool === "list_documents") continue;
      const handler = harness.handlers[tool as keyof Harness["handlers"]] as (
        input: unknown,
      ) => Promise<
        Awaited<ReturnType<Harness["handlers"]["describe_document"]>>
      >;
      const result = await handler(args);
      expect(result.isError, `${tool} failed`).not.toBe(true);
      expect(bodyOf(result), `${tool} declared no mode`).toMatchObject({
        mode: "resident",
      });
    }
  });

  it("rides on every list_documents entry, derived from the scanned size", async () => {
    const result = await harness.handlers.list_documents({ maxResults: 200 });
    const files = bodyOf(result)["files"] as readonly Record<string, unknown>[];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file["mode"], `${String(file["filePath"])}`).toBe(
        modeFor(file["sizeBytes"] as number, modePolicy),
      );
    }
  });

  it("resolves the capability table through the (format, mode) pair", async () => {
    const result = await harness.handlers.describe_document({
      filePath: basename(fixtures.records),
    });
    const body = bodyOf(result);
    expect(body["capabilities"]).toMatchObject({
      recordProjection: true,
      nodeIdentity: true,
      exactTotals: true,
      xpath: true,
    });
  });

  it("reports the knob and everything derived from it", async () => {
    const result = await harness.handlers.describe_document({
      filePath: basename(fixtures.records),
    });
    expect(bodyOf(result)["limits"]).toMatchObject({
      residentMaxBytes: 8 * 1024 * 1024,
      maxChunkBytes: 8 * 1024 * 1024,
      maxLiveChunkDoms: 1,
    });
  });
});
