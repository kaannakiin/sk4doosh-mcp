import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Fixtures } from "./fixtures/build.js";
import { bodyOf, createHarness, type Harness } from "./fixtures/harness.js";

let fixtures: Fixtures;
let harness: Harness;

type AggregateArgs = Parameters<Harness["handlers"]["aggregate_document"]>[0];

async function aggregate(args: Record<string, unknown>) {
  const result = await harness.handlers.aggregate_document(
    args as AggregateArgs,
  );
  return { isError: result.isError === true, body: bodyOf(result) };
}

interface Metric {
  readonly kind: string;
  readonly value?: number;
  readonly valueText?: string;
  readonly counted?: number;
  readonly skipped?: number;
  readonly rounded?: number;
  readonly negativeZero?: true;
}

interface Group {
  readonly key: readonly { readonly status: string; readonly value?: string }[];
  readonly rows: number;
  readonly metrics: readonly Metric[];
}

function groups(body: Record<string, unknown>): readonly Group[] {
  return body["groups"] as readonly Group[];
}

const ledger = {
  ancestors: [{ namespaceUri: "", localName: "ledger" }],
  name: { namespaceUri: "", localName: "row" },
};

const amountColumn = {
  label: "amount",
  name: { namespaceUri: "", localName: "amount" },
};

const currencyColumn = {
  label: "cur",
  name: { namespaceUri: "", localName: "cur" },
};

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("counting first", () => {
  it("counts records without a column and without numericMode", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [amountColumn],
      metrics: [{ fn: "count" }],
    });
    expect(outcome.isError).toBe(false);
    expect(groups(outcome.body)[0]?.metrics[0]).toStrictEqual({
      kind: "count",
      value: 8,
    });
  });

  it("separates a value that is empty from one that is absent", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [amountColumn],
      metrics: [{ fn: "count" }, { fn: "countValues", column: "amount" }],
    });
    expect(groups(outcome.body)[0]?.metrics[1]?.value).toBe(7);
    const reports = outcome.body["columns"] as readonly Record<
      string,
      unknown
    >[];
    expect(reports[0]).toMatchObject({ missingCount: 1, emptyCount: 1 });
  });

  it("counts distinct text without converting anything", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [currencyColumn],
      metrics: [{ fn: "countDistinct", column: "cur" }],
    });
    expect(groups(outcome.body)[0]?.metrics[0]?.value).toBe(4);
  });
});

describe("the numeric gate", () => {
  it("refuses a numeric metric until the caller accepts binary64", async () => {
    for (const fn of ["sum", "avg", "min", "max"]) {
      const outcome = await aggregate({
        filePath: basename(fixtures.amounts),
        itemAddress: ledger,
        columns: [amountColumn],
        metrics: [{ fn, column: "amount" }],
      });
      expect(outcome.isError).toBe(true);
      expect(outcome.body["error"]).toBe("invalid_argument");
      expect(String(outcome.body["recovery"])).toContain("binary64");
    }
  });

  it("refuses a metric that needs a column and was given none", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [amountColumn],
      metrics: [{ fn: "countValues" }],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
  });

  it("sums what it can and reports what it skipped and rounded", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [amountColumn, currencyColumn],
      metrics: [{ fn: "sum", column: "amount" }],
      where: [{ column: "cur", op: "eq", value: "TRY" }],
      numericMode: "binary64",
    });
    const metric = groups(outcome.body)[0]?.metrics[0];
    expect(metric?.value).toBeCloseTo(20.6, 10);
    expect(metric?.counted).toBe(2);
    expect(metric?.skipped).toBe(1);
    expect(metric?.rounded).toBe(1);
  });

  it("treats an exponent as text, because XPath 1.0 has no exponent form", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [amountColumn, currencyColumn],
      metrics: [{ fn: "sum", column: "amount" }],
      where: [{ column: "cur", op: "eq", value: "EUR" }],
      numericMode: "binary64",
    });
    const metric = groups(outcome.body)[0]?.metrics[0];
    expect(metric?.counted).toBe(1);
    expect(metric?.skipped).toBe(2);
    expect(Number.isFinite(metric?.value ?? Number.NaN)).toBe(true);
  });

  it("refuses a value with more digits than binary64 holds", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [amountColumn],
      metrics: [{ fn: "sum", column: "amount" }],
      numericMode: "binary64",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("numeric_precision");
    expect(String(outcome.body["message"])).toContain("1234567890123456789");
  });

  it("keeps negative zero visible in a metric", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [amountColumn, currencyColumn],
      metrics: [{ fn: "min", column: "amount" }],
      where: [{ column: "amount", op: "eq", value: "-0" }],
      numericMode: "binary64",
    });
    const metric = groups(outcome.body)[0]?.metrics[0];
    expect(metric?.valueText).toBe("-0");
    expect(metric?.negativeZero).toBe(true);
  });

  it("reports an empty numeric set as undefined rather than zero", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [amountColumn, currencyColumn],
      metrics: [
        { fn: "avg", column: "amount" },
        { fn: "max", column: "amount" },
      ],
      where: [{ column: "cur", op: "eq", value: "USD" }],
      numericMode: "binary64",
    });
    for (const metric of groups(outcome.body)[0]?.metrics ?? []) {
      expect(metric.kind).toBe("undefined");
    }
  });
});

describe("grouping", () => {
  it("orders groups by key and keeps the counters over the whole scan", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [currencyColumn],
      groupBy: ["cur"],
      metrics: [{ fn: "count" }],
    });
    expect(
      groups(outcome.body).map((group) => group.key[0]?.value),
    ).toStrictEqual(["EUR", "HUGE", "TRY", "USD"]);
    expect(outcome.body["groupCount"]).toBe(4);
    expect(outcome.body["matchedItems"]).toBe(8);
  });

  it("never collides a missing key with an empty one or with their own names", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [amountColumn],
      groupBy: ["amount"],
      metrics: [{ fn: "count" }],
    });
    const states = groups(outcome.body).map((group) => group.key[0]?.status);
    expect(states).toContain("missing");
    expect(states).toContain("empty");
    expect(outcome.body["groupCount"]).toBe(8);
  });

  it("keeps groupCount whole while maxGroups cuts what is returned", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [currencyColumn],
      groupBy: ["cur"],
      metrics: [{ fn: "count" }],
      maxGroups: 2,
    });
    expect(outcome.body["groupCount"]).toBe(4);
    expect(outcome.body["returnedGroups"]).toBe(2);
    expect(outcome.body["matchedItems"]).toBe(8);
    expect(outcome.body["returnedMatchedItems"]).toBeLessThan(8);
    expect(outcome.body["truncated"]).toBe(true);
    expect(outcome.body["truncationReason"]).toBe("maxGroups");
    expect(String(outcome.body["hint"])).toContain("groupCount");
  });

  it("orders by a metric when asked, and refuses an index past the metrics", async () => {
    const ordered = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [currencyColumn],
      groupBy: ["cur"],
      metrics: [{ fn: "count" }],
      orderBy: "metric",
      descending: true,
    });
    const counts = groups(ordered.body).map((group) => group.rows);
    expect(counts).toStrictEqual([...counts].sort((a, b) => b - a));

    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [currencyColumn],
      groupBy: ["cur"],
      metrics: [{ fn: "count" }],
      orderByMetric: 3,
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
  });

  it("returns one whole-set group when nothing is grouped", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [amountColumn],
      metrics: [{ fn: "count" }],
    });
    expect(groups(outcome.body)).toHaveLength(1);
    expect(groups(outcome.body)[0]?.key).toStrictEqual([]);
  });

  it("answers an empty record set with no groups and no error", async () => {
    const outcome = await aggregate({
      filePath: basename(fixtures.amounts),
      itemAddress: ledger,
      columns: [currencyColumn],
      groupBy: ["cur"],
      metrics: [{ fn: "count" }],
      where: [{ column: "cur", op: "eq", value: "nothing" }],
    });
    expect(outcome.isError).toBe(false);
    expect(groups(outcome.body)).toStrictEqual([]);
    expect(outcome.body["groupCount"]).toBe(0);
    expect(outcome.body["matchedItems"]).toBe(0);
    expect(outcome.body["complete"]).toBe(true);
  });
});
