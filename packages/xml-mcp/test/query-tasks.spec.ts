import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { coreLimits } from "@sk-mcp/file-core";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { limits } from "../src/limits.js";
import type { Fixtures } from "./fixtures/build.js";
import { namespaces, queryCorpus } from "./fixtures/manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../dist/cli.js");

let fixtures: Fixtures;
let client: Client;
let transport: StdioClientTransport;

interface Answer {
  readonly isError: boolean;
  readonly body: Record<string, unknown>;
}

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<Answer> {
  const result = (await client.callTool({
    name,
    arguments: args,
  })) as CallToolResult;
  const block = result.content[0];
  if (block === undefined || block.type !== "text") {
    throw new Error("the tool returned no text block");
  }
  expect(Buffer.byteLength(block.text, "utf8")).toBeLessThanOrEqual(
    coreLimits.maxPayloadBytes,
  );
  return {
    isError: result.isError === true,
    body: JSON.parse(block.text) as Record<string, unknown>,
  };
}

interface Cell {
  readonly status: string;
  readonly value?: string;
}

interface Row {
  readonly occurrence: number;
  readonly cells: readonly Cell[];
}

function rows(body: Record<string, unknown>): readonly Row[] {
  return body["rows"] as readonly Row[];
}

const plain = (localName: string) => ({ namespaceUri: "", localName });

beforeAll(async () => {
  fixtures = inject("fixtures");
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, fixtures.root],
  });
  client = new Client({ name: "xml-query-tasks", version: "0.0.0" });
  await client.connect(transport);
}, 40_000);

afterAll(async () => {
  await client.close();
});

describe("golden agent tasks", () => {
  it("extracts every JUnit failure with its message and its stack", async () => {
    const answer = await call("project_records", {
      filePath: "junit.xml",
      itemAddress: {
        ancestors: [plain("testsuites"), plain("testsuite")],
        name: plain("testcase"),
      },
      columns: [
        {
          label: "test",
          value: { from: "attribute", namespaceUri: "", localName: "name" },
        },
        {
          label: "reason",
          name: plain("failure"),
          value: {
            from: "attribute",
            namespaceUri: "",
            localName: "message",
          },
        },
        { label: "stack", name: plain("failure") },
      ],
      where: [{ column: "reason", op: "isPresent" }],
    });

    expect(answer.isError).toBe(false);
    expect(answer.body["matchedItems"]).toBe(2);
    expect(
      rows(answer.body).map((row) => [
        row.cells[0]?.value,
        row.cells[1]?.value,
        row.cells[2]?.value,
      ]),
    ).toStrictEqual([
      ["breaks", "expected 2 but was 3", "at Alpha.breaks(Alpha.java:11)"],
      ["throws", "null pointer", "at Beta.throws(Beta.java:4)"],
    ]);
  });

  it("projects the pom dependencies without taking the trap namespace", async () => {
    const maven = namespaces.maven;
    const step = (localName: string) => ({
      namespaceUri: maven,
      localName,
    });
    const answer = await call("project_records", {
      filePath: "pom.xml",
      itemAddress: {
        ancestors: [step("project"), step("dependencies")],
        name: step("dependency"),
      },
      columns: [
        { label: "group", name: step("groupId") },
        { label: "artifact", name: step("artifactId") },
        { label: "version", name: step("version") },
      ],
    });

    expect(answer.isError).toBe(false);
    expect(answer.body["totalItems"]).toBe(2);
    expect(
      rows(answer.body).map((row) => [
        row.cells[1]?.value,
        row.cells[2]?.value,
      ]),
    ).toStrictEqual([
      ["alpha", "1.0.0"],
      ["beta", "2.3.4"],
    ]);
    expect(JSON.stringify(answer.body)).not.toContain("9.9.9");
  });

  it("counts the invoice lines and refuses to total a value it would corrupt", async () => {
    const counted = await call("aggregate_document", {
      filePath: "invoice.xml",
      itemAddress: {
        ancestors: [plain("Invoice")],
        name: plain("Line"),
      },
      columns: [{ label: "amount", name: plain("Amount") }],
      metrics: [{ fn: "count" }, { fn: "countValues", column: "amount" }],
    });
    expect(counted.isError).toBe(false);
    const groups = counted.body["groups"] as readonly {
      readonly metrics: readonly { readonly value?: number }[];
    }[];
    expect(groups[0]?.metrics[0]?.value).toBe(2);
    expect(groups[0]?.metrics[1]?.value).toBe(2);

    const totalled = await call("aggregate_document", {
      filePath: "invoice.xml",
      itemAddress: {
        ancestors: [plain("Invoice")],
        name: plain("Line"),
      },
      columns: [{ label: "amount", name: plain("Amount") }],
      metrics: [{ fn: "sum", column: "amount" }],
      numericMode: "binary64",
    });
    expect(totalled.isError).toBe(true);
    expect(totalled.body["error"]).toBe("numeric_precision");
    expect(String(totalled.body["message"])).toContain("1234567890123456789");
  });
});

describe("the adversarial query corpus", () => {
  it("answers every expression with a typed result or a named fault", async () => {
    for (const entry of queryCorpus) {
      const answer = await call("select_xpath", {
        filePath: entry.file,
        xpath: entry.xpath,
        ...(entry.namespaces === undefined
          ? {}
          : { namespaces: entry.namespaces }),
      });
      if (entry.expect === "error") {
        expect(answer.isError, entry.id).toBe(true);
        expect(String(answer.body["error"]), entry.id).toBe(entry.code);
        expect(
          String(answer.body["recovery"]).length,
          entry.id,
        ).toBeGreaterThan(0);
      } else {
        expect(answer.isError, entry.id).toBe(false);
        expect(String(answer.body["resultType"]), entry.id).toBe(entry.expect);
      }
      expect(String(answer.body["error"] ?? ""), entry.id).not.toBe(
        "internal_error",
      );
      expect(JSON.stringify(answer.body), entry.id).not.toContain(
        fixtures.root,
      );
    }
  }, 60_000);
});

describe("the published schema", () => {
  it("refuses an expression longer than the published ceiling", async () => {
    const answer = await client.callTool({
      name: "select_xpath",
      arguments: {
        filePath: "simple.xml",
        xpath: `//item[${"0".repeat(limits.maxXpathChars)}]`,
      },
    });
    expect(answer.isError).toBe(true);
  });

  it("refuses more namespace bindings than the schema allows", async () => {
    const answer = await client.callTool({
      name: "select_xpath",
      arguments: {
        filePath: "simple.xml",
        xpath: "//item",
        namespaces: Array.from(
          { length: limits.maxNamespaceBindings + 1 },
          (_, index) => ({
            prefix: `p${String(index)}`,
            uri: `urn:${String(index)}`,
          }),
        ),
      },
    });
    expect(answer.isError).toBe(true);
  });

  it("refuses a record projection with no columns", async () => {
    const answer = await client.callTool({
      name: "project_records",
      arguments: {
        filePath: "records.xml",
        itemAddress: {
          ancestors: [plain("catalogue")],
          name: plain("entry"),
        },
        columns: [],
      },
    });
    expect(answer.isError).toBe(true);
  });
});
