import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { createWorkbookRoot, type WorkbookRoot } from "../src/paths.js";
import { createExcelMcpServer } from "../src/server.js";
import {
  createHandlers,
  toolDefinitions,
  type ToolHandlers,
} from "../src/tools.js";

function payload(result: CallToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("the tool returned no text content");
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

describe("tool registration", () => {
  it("registers exactly the declared tools", async () => {
    const fixtures = inject("fixtures");
    const server = createExcelMcpServer(
      await createWorkbookRoot(fixtures.root),
    );
    const client = new Client({ name: "excel-spec", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const listed = (await client.listTools()).tools;
    expect(listed.map((tool) => tool.name).sort()).toEqual(
      Object.keys(toolDefinitions).sort(),
    );
    expect(
      listed.every((tool) => tool.annotations?.readOnlyHint === true),
    ).toBe(true);

    await client.close();
    await server.close();
  });
});

describe("handlers", () => {
  let handlers: ToolHandlers;
  let root: WorkbookRoot;

  beforeAll(async () => {
    const fixtures = inject("fixtures");
    root = await createWorkbookRoot(fixtures.root);
    handlers = createHandlers(root);
  });

  it("lists workbooks", async () => {
    const result = await handlers.list_workbooks({});
    expect(result.isError).toBeUndefined();
    expect(payload(result)["root"]).toBe(root.real);
  });

  it("describes a workbook", async () => {
    const result = await handlers.describe_workbook({
      filePath: "q1/sample.xlsx",
    });
    expect(payload(result)["dateSystem"]).toBe("1900");
  });

  it("reads a sheet", async () => {
    const result = await handlers.read_sheet({
      filePath: "q1/sample.xlsx",
      range: "A1:B3",
    });
    expect(payload(result)["values"]).toEqual([
      ["EMEA0", 1],
      ["EMEA1", 2],
    ]);
  });

  it("returns merged ranges", async () => {
    const result = await handlers.get_merged_ranges({
      filePath: "q1/sample.xlsx",
    });
    expect(payload(result)["merges"]).toEqual(["A10:C10"]);
  });

  it("returns data validations", async () => {
    const result = await handlers.get_data_validations({
      filePath: "validations.xlsx",
    });
    expect(payload(result)["count"]).toBe(2);
  });

  it("aggregates a sheet", async () => {
    const result = await handlers.aggregate_sheet({
      filePath: "q1/sample.xlsx",
      metrics: [{ fn: "count" }],
    });
    expect(result.isError).toBeUndefined();
    expect(payload(result)["matchedRows"]).toBeGreaterThan(0);
  });

  it("says who chose the header row", async () => {
    const fallback = await handlers.read_sheet({ filePath: "title-band.xlsx" });
    expect(payload(fallback)["headerRowSource"]).toBe("default");
    const explicit = await handlers.read_sheet({
      filePath: "title-band.xlsx",
      headerRow: 3,
    });
    expect(payload(explicit)["headerRowSource"]).toBe("explicit");
  });

  it("proves the header row on request", async () => {
    const result = await handlers.read_sheet({
      filePath: "title-band.xlsx",
      sheetName: "Faturalar",
      headerScan: true,
    });
    const body = payload(result);
    expect(body["headerRow"]).toBe(3);
    expect(body["headerRowSource"]).toBe("scanned");
  });

  it("reads the header row a table declares", async () => {
    const result = await handlers.read_sheet({
      filePath: "title-band.xlsx",
      sheetName: "Declared",
      headerScan: true,
    });
    const body = payload(result);
    expect(body["headerRow"]).toBe(3);
    expect(body["headerRowSource"]).toBe("declared");
  });

  it("finds cells", async () => {
    const result = await handlers.find_in_sheet({
      filePath: "q1/sample.xlsx",
      query: "EMEA1",
    });
    expect(payload(result)["total"]).toBe(1);
  });
});

describe("error surfacing", () => {
  let handlers: ToolHandlers;

  beforeAll(async () => {
    const fixtures = inject("fixtures");
    handlers = createHandlers(await createWorkbookRoot(fixtures.root));
  });

  it.each([
    ["../package.json.xlsx", "path_outside_root"],
    ["missing.xlsx", "file_not_found"],
    ["corrupt.xlsx", "corrupt_workbook"],
    ["encrypted.xlsx", "encrypted_workbook"],
  ])("maps %s to %s", async (filePath, code) => {
    const result = await handlers.describe_workbook({ filePath });
    expect(result.isError).toBe(true);
    expect(payload(result)["error"]).toBe(code);
  });

  it("refuses headerScan combined with headerRow", async () => {
    const result = await handlers.read_sheet({
      filePath: "title-band.xlsx",
      headerScan: true,
      headerRow: 3,
    });
    expect(payload(result)["error"]).toBe("invalid_argument");
  });

  it("refuses headerScan combined with a cursor", async () => {
    const result = await handlers.read_sheet({
      filePath: "title-band.xlsx",
      headerScan: true,
      cursor: "x",
    });
    expect(payload(result)["error"]).toBe("invalid_argument");
  });

  it("refuses headerScan for a delimited file", async () => {
    const result = await handlers.read_sheet({
      filePath: "csv/simple.csv",
      headerScan: true,
    });
    expect(payload(result)["error"]).toBe("unsupported_for_format");
  });

  it("reports a missing subdirectory as file_not_found, not a corrupt workbook", async () => {
    const result = await handlers.list_workbooks({ subdirectory: "nope" });
    expect(result.isError).toBe(true);
    const body = payload(result);
    expect(body["error"]).toBe("file_not_found");
    expect(String(body["message"])).not.toContain("could not be read");
    expect(String(body["recovery"])).not.toContain("re-save");
  });

  it("surfaces an ambiguous column as a tool error", async () => {
    const result = await handlers.aggregate_sheet({
      filePath: "analysis.xlsx",
      groupBy: ["Total"],
      metrics: [{ fn: "count" }],
    });
    expect(result.isError).toBe(true);
    expect(payload(result)["error"]).toBe("ambiguous_column");
    expect(String(payload(result)["recovery"])).toContain('"B"');
  });

  it("surfaces an unknown column with the resolvable columns", async () => {
    const result = await handlers.aggregate_sheet({
      filePath: "analysis.xlsx",
      groupBy: ["Nope"],
      metrics: [{ fn: "count" }],
    });
    expect(payload(result)["error"]).toBe("unknown_column");
    expect(String(payload(result)["recovery"])).toContain("A (Region)");
  });

  it("reports an unknown sheet with a recovery hint", async () => {
    const result = await handlers.read_sheet({
      filePath: "q1/sample.xlsx",
      sheetName: "Nope",
    });
    expect(result.isError).toBe(true);
    const body = payload(result);
    expect(body["error"]).toBe("unknown_sheet");
    expect(String(body["recovery"])).toContain("Notes (hidden)");
  });

  it("reports an empty sheet", async () => {
    const result = await handlers.read_sheet({ filePath: "empty.xlsx" });
    expect(payload(result)["error"]).toBe("empty_sheet");
  });

  it("reports an invalid range", async () => {
    const result = await handlers.read_sheet({
      filePath: "q1/sample.xlsx",
      range: "not-a-range",
    });
    expect(payload(result)["error"]).toBe("invalid_range");
  });

  it("rejects a cursor combined with a range", async () => {
    const result = await handlers.read_sheet({
      filePath: "q1/sample.xlsx",
      cursor: "x",
      range: "A1:B2",
    });
    expect(payload(result)["error"]).toBe("invalid_argument");
  });
});
