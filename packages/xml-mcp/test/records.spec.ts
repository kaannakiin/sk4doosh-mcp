import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Fixtures } from "./fixtures/build.js";
import { bodyOf, createHarness, type Harness } from "./fixtures/harness.js";

let fixtures: Fixtures;
let harness: Harness;

type ProjectArgs = Parameters<Harness["handlers"]["project_records"]>[0];

async function project(args: Record<string, unknown>) {
  const result = await harness.handlers.project_records(args as ProjectArgs);
  return { isError: result.isError === true, body: bodyOf(result) };
}

interface Cell {
  readonly status: string;
  readonly value?: string;
  readonly values?: readonly string[];
  readonly count?: number;
  readonly mixed?: true;
}

interface Row {
  readonly nodeId: string;
  readonly occurrence: number;
  readonly cells: readonly Cell[];
}

function rows(body: Record<string, unknown>): readonly Row[] {
  return body["rows"] as readonly Row[];
}

const catalogue = {
  ancestors: [{ namespaceUri: "", localName: "catalogue" }],
  name: { namespaceUri: "", localName: "entry" },
};

const nameColumn = {
  label: "name",
  name: { namespaceUri: "", localName: "name" },
};

const tagColumn = {
  label: "tag",
  name: { namespaceUri: "", localName: "tag" },
};

const codeColumn = {
  label: "code",
  value: { from: "attribute", namespaceUri: "", localName: "code" },
};

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("the record set", () => {
  it("takes every sibling with the record name and no other element", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [codeColumn],
    });
    expect(outcome.body["totalItems"]).toBe(5);
    expect(rows(outcome.body).map((row) => row.cells[0]?.value)).toStrictEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("gives each row an occurrence that rebuilds its address without repeating it", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [codeColumn],
    });
    expect(rows(outcome.body).map((row) => row.occurrence)).toStrictEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(outcome.body["itemName"]).toStrictEqual({
      namespaceUri: "",
      localName: "entry",
    });
    for (const row of rows(outcome.body)) {
      expect(row).not.toHaveProperty("address");
    }
  });

  it("refuses a record address that matches no holder", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: {
        ancestors: [{ namespaceUri: "", localName: "nowhere" }],
        name: { namespaceUri: "", localName: "entry" },
      },
      columns: [codeColumn],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
  });
});

describe("cell states", () => {
  it("separates present, empty, missing and multiple", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [nameColumn, tagColumn],
    });
    const cells = rows(outcome.body).map((row) => [
      row.cells[0]?.status,
      row.cells[1]?.status,
    ]);
    expect(cells).toStrictEqual([
      ["present", "present"],
      ["empty", "multiple"],
      ["missing", "present"],
      ["present", "missing"],
      ["present", "missing"],
    ]);
  });

  it("counts each state per column", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [nameColumn, tagColumn],
    });
    const reports = outcome.body["columns"] as readonly Record<
      string,
      unknown
    >[];
    expect(reports[0]).toMatchObject({
      label: "name",
      missingCount: 1,
      emptyCount: 1,
      mixedCount: 1,
    });
    expect(reports[1]).toMatchObject({ label: "tag", multipleCount: 1 });
  });

  it("never picks a value when several match and no policy says which", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [tagColumn],
    });
    const multiple = rows(outcome.body)[1]?.cells[0];
    expect(multiple?.status).toBe("multiple");
    expect(multiple?.count).toBe(2);
    expect(multiple?.value).toBeUndefined();
  });

  it("returns every value when the column asks for a list", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [{ ...tagColumn, onMultiple: "list" }],
    });
    const listed = rows(outcome.body)[1]?.cells[0];
    expect(listed?.status).toBe("list");
    expect(listed?.values).toStrictEqual(["x", "y"]);
    expect(listed?.count).toBe(2);
  });

  it("takes the first value only when asked explicitly", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [{ ...tagColumn, onMultiple: "first" }],
    });
    expect(rows(outcome.body)[1]?.cells[0]).toStrictEqual({
      status: "present",
      value: "x",
    });
  });

  it("marks a cell mixed instead of flattening nested markup silently", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [nameColumn],
    });
    const mixed = rows(outcome.body)[3]?.cells[0];
    expect(mixed?.status).toBe("present");
    expect(mixed?.value).toBe("leadtail");
    expect(mixed?.mixed).toBe(true);
  });

  it("reads the record's own attribute and local name", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [codeColumn, { label: "kind", value: { from: "name" } }],
    });
    expect(rows(outcome.body)[0]?.cells[1]).toStrictEqual({
      status: "present",
      value: "entry",
    });
  });
});

describe("the row filter", () => {
  it("keeps only rows whose declared column holds the value", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [codeColumn, nameColumn],
      where: [{ column: "name", op: "eq", value: "alpha" }],
    });
    expect(outcome.body["matchedItems"]).toBe(1);
    expect(rows(outcome.body)[0]?.cells[0]?.value).toBe("a");
  });

  it("separates a missing column from an empty one", async () => {
    const missing = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [codeColumn, nameColumn],
      where: [{ column: "name", op: "isMissing" }],
    });
    expect(missing.body["matchedItems"]).toBe(1);
    expect(rows(missing.body)[0]?.cells[0]?.value).toBe("c");

    const empty = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [codeColumn, nameColumn],
      where: [{ column: "name", op: "isEmpty" }],
    });
    expect(rows(empty.body)[0]?.cells[0]?.value).toBe("b");
  });

  it("never matches a multiple cell with a textual comparison", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [codeColumn, tagColumn],
      where: [{ column: "tag", op: "ne", value: "nothing" }],
    });
    expect(rows(outcome.body).map((row) => row.cells[0]?.value)).toStrictEqual([
      "a",
      "c",
    ]);
  });

  it("combines conditions with all and any", async () => {
    const all = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [codeColumn, nameColumn, tagColumn],
      where: [
        { column: "name", op: "isNotEmpty" },
        { column: "tag", op: "isPresent" },
      ],
    });
    expect(all.body["matchedItems"]).toBe(1);

    const any = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [codeColumn, nameColumn, tagColumn],
      where: [
        { column: "name", op: "eq", value: "alpha" },
        { column: "name", op: "eq", value: "epsilon" },
      ],
      match: "any",
    });
    expect(any.body["matchedItems"]).toBe(2);
  });

  it("is case-sensitive unless asked otherwise", async () => {
    const sensitive = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [nameColumn],
      where: [{ column: "name", op: "eq", value: "ALPHA" }],
    });
    expect(sensitive.body["matchedItems"]).toBe(0);

    const folded = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [nameColumn],
      where: [{ column: "name", op: "eq", value: "ALPHA" }],
      caseSensitive: false,
    });
    expect(folded.body["matchedItems"]).toBe(1);
  });

  it("folds ASCII case only, so a dotted capital I is not a fold of i", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [nameColumn],
      where: [{ column: "name", op: "eq", value: "\u0130STANBUL" }],
      caseSensitive: false,
    });
    expect(outcome.isError).toBe(false);
    expect(outcome.body["matchedItems"]).toBe(0);
  });

  it("refuses a condition on a column that was never declared", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [nameColumn],
      where: [{ column: "tag", op: "isPresent" }],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
    expect(String(outcome.body["message"])).toContain("tag");
  });

  it("refuses two columns with the same label", async () => {
    const outcome = await project({
      filePath: basename(fixtures.records),
      itemAddress: catalogue,
      columns: [nameColumn, { ...tagColumn, label: "name" }],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
  });
});

describe("paging rows", () => {
  it("joins the pages into every matching row exactly once", async () => {
    const seen: string[] = [];
    let cursor: unknown;
    let pages = 0;
    for (;;) {
      const outcome = await project({
        filePath: basename(fixtures.wideQuery),
        itemAddress: catalogue,
        columns: [codeColumn],
        maxRows: 70,
        ...(cursor === undefined ? {} : { cursor }),
      });
      expect(outcome.isError).toBe(false);
      seen.push(...rows(outcome.body).map((row) => row.nodeId));
      pages += 1;
      cursor = outcome.body["nextCursor"];
      if (cursor === undefined || pages > 10) break;
    }
    expect(seen).toHaveLength(300);
    expect(new Set(seen).size).toBe(300);
    expect(pages).toBe(5);
  });

  it("reports the reason a page stopped", async () => {
    const outcome = await project({
      filePath: basename(fixtures.wideQuery),
      itemAddress: catalogue,
      columns: [codeColumn],
      maxRows: 70,
    });
    expect(outcome.body["truncated"]).toBe(true);
    expect(outcome.body["truncationReason"]).toBe("maxRows");
    expect(outcome.body["matchedItems"]).toBe(300);
    expect(outcome.body["returnedRows"]).toBe(70);
  });

  it("refuses a records cursor handed to the query tool", async () => {
    const first = await project({
      filePath: basename(fixtures.wideQuery),
      itemAddress: catalogue,
      columns: [codeColumn],
      maxRows: 10,
    });
    const outcome = await harness.handlers.select_xpath({
      filePath: basename(fixtures.wideQuery),
      xpath: "//name",
      cursor: first.body["nextCursor"],
    } as Parameters<Harness["handlers"]["select_xpath"]>[0]);
    expect(outcome.isError).toBe(true);
    expect(bodyOf(outcome)["error"]).toBe("invalid_cursor");
  });
});
