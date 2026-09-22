import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Fixtures } from "./fixtures/build.js";
import { bodyOf, createHarness, type Harness } from "./fixtures/harness.js";

let fixtures: Fixtures;
let resident: Harness;
let chunked: Harness;

const catalogue = {
  ancestors: [{ namespaceUri: "", localName: "catalogue" }],
  name: { namespaceUri: "", localName: "entry" },
};

const codeColumn = {
  label: "code",
  value: { from: "attribute", namespaceUri: "", localName: "code" },
};

const nameColumn = {
  label: "name",
  name: { namespaceUri: "", localName: "name" },
};

type ProjectArgs = Parameters<Harness["handlers"]["project_records"]>[0];

function omit(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
}

function strip(body: Record<string, unknown>): Record<string, unknown> {
  const rows = (body["rows"] as readonly Record<string, unknown>[]).map((row) =>
    omit(row, ["nodeId"]),
  );
  return { ...omit(body, ["mode", "totalItemsExact", "nextCursor"]), rows };
}

async function project(
  harness: Harness,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await harness.handlers.project_records(args as ProjectArgs);
  return bodyOf(result);
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  resident = await createHarness(fixtures.root);
  chunked = await createHarness(fixtures.root, undefined, 1);
});

afterAll(async () => {
  await resident.close();
  await chunked.close();
});

describe("the chunked tier answers like the resident tier", () => {
  it.each([
    ["a whole page", { columns: [codeColumn, nameColumn] }],
    ["a narrow page", { columns: [codeColumn], maxRows: 2 }],
    [
      "a filtered page",
      {
        columns: [codeColumn, nameColumn],
        where: [{ column: "name", op: "eq", value: "alpha" }],
      },
    ],
  ])(
    "matches the resident envelope for %s, apart from mode, totalItemsExact and nodeId",
    async (_label, extra) => {
      const args = {
        filePath: basename(fixtures.records),
        itemAddress: catalogue,
        ...extra,
      };
      const left = await project(resident, args);
      const right = await project(chunked, args);

      expect(left["mode"]).toBe("resident");
      expect(right["mode"]).toBe("chunked");

      expect(strip(right)).toStrictEqual(strip(left));
    },
  );

  it("carries occurrence and never a node address", async () => {
    const body = await project(chunked, {
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [codeColumn],
    });
    const rows = body["rows"] as readonly Record<string, unknown>[];
    expect(rows.map((row) => row["occurrence"])).toStrictEqual([1, 2, 3, 4, 5]);
    for (const row of rows) expect(row).not.toHaveProperty("nodeId");
  });

  it("declares that node identity and exact totals are gone", async () => {
    const body = bodyOf(
      await chunked.handlers.describe_document({
        filePath: basename(fixtures.records),
      }),
    );
    expect(body["mode"]).toBe("chunked");
    expect(body["capabilities"]).toMatchObject({
      recordProjection: true,
      nodeIdentity: false,
      exactTotals: false,
      xpath: false,
      aggregation: false,
      literalSearch: false,
    });
  });

  it("describes the document from the byte survey", async () => {
    const body = bodyOf(
      await chunked.handlers.describe_document({
        filePath: basename(fixtures.records),
      }),
    );
    expect(body["root"]).toMatchObject({ localName: "catalogue" });
    expect(body["repetitionCandidates"]).toContainEqual(
      expect.objectContaining({ localName: "entry", count: 5 }),
    );
  });
});

describe("the chunked tier refuses what it cannot carry", () => {
  const filePath = () => basename(fixtures.records);

  it.each([
    ["read_node", () => chunked.handlers.read_node({ filePath: filePath() })],
    [
      "find_in_document",
      () =>
        chunked.handlers.find_in_document({
          filePath: filePath(),
          query: "alpha",
        }),
    ],
    [
      "select_xpath",
      () =>
        chunked.handlers.select_xpath({ filePath: filePath(), xpath: "//*" }),
    ],
    [
      "aggregate_document",
      () =>
        chunked.handlers.aggregate_document({
          filePath: filePath(),
          itemAddress: catalogue,
          columns: [codeColumn],
          metrics: [{ fn: "count" }],
        } as Parameters<Harness["handlers"]["aggregate_document"]>[0]),
    ],
  ])("refuses %s with a repair", async (tool, call) => {
    const result = await call();
    expect(result.isError).toBe(true);
    const body = bodyOf(result);
    expect(body["error"]).toBe("unsupported_for_format");
    expect(body["message"]).toContain(tool);
    expect(body["recovery"]).toContain("project_records");
  });
});
