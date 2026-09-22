import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it } from "vitest";
import { McpSourceError } from "@sk-mcp/mcp-core";
import {
  connectionSecret,
  createDbMcpServer,
  createDbSource,
  dbCoreLimits,
  toolNames,
  type DbVocabulary,
  type QuerySpec,
} from "../src/index.js";
import {
  column,
  createFakeDialect,
  createFakeDriver,
  fail,
  rows,
  type FakeConfig,
  type Script,
} from "./fake.js";

const vocabulary: DbVocabulary<string> = {
  serverName: "probe-db",
  subject: "database",
  listTool: "list_tables",
  describeTool: "describe_table",
  queryTool: "run_query",
  engineLabel: "Probe SQL",
  catalogLabel: "database",
  schemaLabel: "schema",
  objectLabel: "table",
  tooManyRowsRecovery: "Add your own ORDER BY with OFFSET/FETCH.",
  readOnlyRecovery: "Connect with a read-only principal.",
};

const normalize = (error: unknown): McpSourceError =>
  error instanceof McpSourceError
    ? error
    : fail("internal_error", "probe failed");

const config: FakeConfig = { host: "db.internal", password: "hunter2" };

interface TextResult {
  readonly content: readonly unknown[];
  readonly isError?: boolean;
}

function body(result: TextResult): Record<string, unknown> {
  const first = result.content[0] as { type: string; text: string };
  return JSON.parse(first.text) as Record<string, unknown>;
}

const catalogRows: Record<string, Script> = {
  server: rows(
    [column("engineVersion", 0), column("catalog", 1), column("principal", 2)],
    [["Probe 1.0", "Sales", "mcp_reader"]],
  ),
  tables: rows(
    [column("schema", 0), column("name", 1), column("kind", 2)],
    [
      ["dbo", "Orders", "table"],
      ["dbo", "OrderView", "view"],
    ],
  ),
  columns: rows(
    [
      column("name", 0),
      column("ordinal", 1),
      column("nativeType", 2),
      column("nullable", 3),
    ],
    [
      ["Id", 0, "int", false],
      ["Note", 1, "text", true],
    ],
  ),
  keys: rows(
    [column("name", 0), column("kind", 1), column("columns", 2)],
    [["PK_Orders", "primary", ["Id"]]],
  ),
};

function build(respond: (spec: QuerySpec) => Script) {
  const driver = createFakeDriver({ respond });
  const source = createDbSource(
    { dialect: createFakeDialect(), vocabulary, fail },
    {
      alias: "sales",
      secret: connectionSecret(config),
      display: { alias: "sales", engine: "Probe SQL", catalog: "Sales" },
    },
    driver.adapter,
  );
  return { driver, source };
}

let client: Client;

async function connect(respond: (spec: QuerySpec) => Script): Promise<void> {
  const { source } = build(respond);
  const server = createDbMcpServer(
    { name: "probe-db", version: "9.9.9" },
    source,
    normalize,
  );
  client = new Client({ name: "db-spec", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
}

const catalogOnly = (spec: QuerySpec): Script =>
  catalogRows[spec.sql] ?? rows([column("a", 0)], [["x"]]);

describe("the tool catalogue", () => {
  beforeEach(async () => {
    await connect(catalogOnly);
  });

  it("registers exactly the four read-only tools", async () => {
    const listed = (await client.listTools()).tools;
    expect(listed.map((tool) => tool.name).sort()).toEqual(
      [...toolNames].sort(),
    );
    expect(listed).toHaveLength(4);
  });

  it("carries the read-only annotations over the wire", async () => {
    const listed = (await client.listTools()).tools;
    expect(
      listed.every(
        (tool) =>
          tool.annotations?.readOnlyHint === true &&
          tool.annotations?.openWorldHint === false,
      ),
    ).toBe(true);
  });
});

describe("describe_connection", () => {
  beforeEach(async () => {
    await connect(catalogOnly);
  });

  it("reports the engine, the catalogue and the read-only posture", async () => {
    const result = (await client.callTool({
      name: "describe_connection",
      arguments: {},
    })) as TextResult;
    const envelope = body(result);
    expect(envelope["alias"]).toBe("sales");
    expect(envelope["engineVersion"]).toBe("Probe 1.0");
    expect(envelope["catalog"]).toBe("Sales");
    expect(envelope["readOnly"]).toMatchObject({
      sessionIntent: "none",
      statementGuard: "advisory",
    });
  });

  it("never returns anything from the connection secret", async () => {
    const result = (await client.callTool({
      name: "describe_connection",
      arguments: {},
    })) as TextResult;
    const text = JSON.stringify(body(result));
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("db.internal");
  });
});

describe("list_tables and describe_table", () => {
  beforeEach(async () => {
    await connect(catalogOnly);
  });

  it("returns schema-qualified entries", async () => {
    const result = (await client.callTool({
      name: "list_tables",
      arguments: {},
    })) as TextResult;
    expect(body(result)["tables"]).toEqual([
      { schema: "dbo", name: "Orders", kind: "table" },
      { schema: "dbo", name: "OrderView", kind: "view" },
    ]);
    expect(body(result)["complete"]).toBe(true);
  });

  it("marks the page truncated when maxResults cuts it", async () => {
    const result = (await client.callTool({
      name: "list_tables",
      arguments: { maxResults: 1 },
    })) as TextResult;
    const envelope = body(result);
    expect(envelope["returnedCount"]).toBe(1);
    expect(envelope["truncated"]).toBe(true);
    expect(envelope["truncationReason"]).toBe("maxResults");
  });

  it("returns columns and the primary key", async () => {
    const result = (await client.callTool({
      name: "describe_table",
      arguments: { schema: "dbo", table: "Orders" },
    })) as TextResult;
    const envelope = body(result);
    expect(envelope["primaryKey"]).toEqual(["Id"]);
    expect(envelope["columns"]).toHaveLength(2);
  });

  it("reports object_not_found and points at the list tool", async () => {
    await connect((spec) =>
      spec.sql === "columns" ? rows([], []) : catalogOnly(spec),
    );
    const result = (await client.callTool({
      name: "describe_table",
      arguments: { schema: "dbo", table: "Missing" },
    })) as TextResult;
    expect(result.isError).toBe(true);
    const envelope = body(result);
    expect(envelope["error"]).toBe("object_not_found");
    expect(String(envelope["recovery"])).toContain("list_tables");
  });
});

describe("run_query", () => {
  it("returns the rows a select produced", async () => {
    await connect((spec) =>
      spec.sql === "select 1"
        ? rows([column("n", 0, "integer")], [[1], [2]])
        : catalogOnly(spec),
    );
    const result = (await client.callTool({
      name: "run_query",
      arguments: { sql: "select 1" },
    })) as TextResult;
    const envelope = body(result);
    expect(envelope["rows"]).toEqual([[1], [2]]);
    expect(envelope["complete"]).toBe(true);
  });

  it("refuses a write through the dialect guard, before any connection is used", async () => {
    const { source } = build(catalogOnly);
    const server = createDbMcpServer(
      { name: "probe-db", version: "9.9.9" },
      source,
      normalize,
    );
    const local = new Client({ name: "db-spec", version: "0.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([local.connect(a), server.connect(b)]);
    const result = (await local.callTool({
      name: "run_query",
      arguments: { sql: "delete from Orders" },
    })) as TextResult;
    expect(result.isError).toBe(true);
    expect(body(result)["error"]).toBe("write_not_permitted");
  });

  it("marks the page truncated when the driver stopped at maxRows", async () => {
    await connect((spec) =>
      spec.sql === "select 1"
        ? rows([column("n", 0, "integer")], [[1]], true)
        : catalogOnly(spec),
    );
    const result = (await client.callTool({
      name: "run_query",
      arguments: { sql: "select 1", maxRows: 1 },
    })) as TextResult;
    const envelope = body(result);
    expect(envelope["truncated"]).toBe(true);
    expect(envelope["truncationReason"]).toBe("maxRows");
    expect(String(envelope["hint"])).toContain("OFFSET");
  });

  it("stops admitting rows at the payload budget and stays inside it", async () => {
    const wide = Array.from({ length: 5_000 }, () => ["x".repeat(200)]);
    await connect((spec) =>
      spec.sql === "select 1"
        ? rows([column("blob", 0)], wide)
        : catalogOnly(spec),
    );
    const result = (await client.callTool({
      name: "run_query",
      arguments: { sql: "select 1" },
    })) as TextResult;
    const first = result.content[0] as { text: string };
    const envelope = body(result);
    expect(envelope["truncated"]).toBe(true);
    expect(envelope["truncationReason"]).toBe("maxPayloadBytes");
    expect(Buffer.byteLength(first.text, "utf8")).toBeLessThanOrEqual(
      dbCoreLimits.maxPayloadBytes,
    );
  });

  it("classifies a driver failure through the dialect and redacts the secret", async () => {
    await connect((spec) =>
      spec.sql === "select 1"
        ? {
            kind: "throw",
            error: new Error("login failed for mssql://sa:hunter2@db.internal"),
          }
        : catalogOnly(spec),
    );
    const result = (await client.callTool({
      name: "run_query",
      arguments: { sql: "select 1" },
    })) as TextResult;
    expect(result.isError).toBe(true);
    const envelope = body(result);
    expect(envelope["error"]).toBe("authentication_failed");
    expect(String(envelope["message"])).toContain("18456");
    expect(JSON.stringify(envelope)).not.toContain("hunter2");
  });

  it("refuses arguments the schema does not accept before the handler runs", async () => {
    await connect(catalogOnly);
    const result = (await client.callTool({
      name: "run_query",
      arguments: { sql: "" },
    })) as TextResult;
    expect(result.isError).toBe(true);
  });
});
