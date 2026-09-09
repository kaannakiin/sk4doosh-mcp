import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { coreLimits } from "@sk-mcp/file-core";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Fixtures } from "./fixtures/build.js";
import {
  expectedTargetFrameworkAddress,
  files,
  namespaces,
  scenarios,
} from "./fixtures/manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../dist/cli.js");

let fixtures: Fixtures;
let client: Client;
let transport: StdioClientTransport;

interface Transcript {
  calls: number;
  bytes: number;
}

const transcript: Record<string, Transcript> = {};
let current = "";

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ readonly isError: boolean; readonly body: Record<string, unknown> }> {
  const result = (await client.callTool({
    name,
    arguments: args,
  })) as CallToolResult;
  const block = result.content[0];
  if (block === undefined || block.type !== "text") {
    throw new Error("the tool returned no text block");
  }
  const entry = transcript[current] ?? { calls: 0, bytes: 0 };
  entry.calls += 1;
  entry.bytes += Buffer.byteLength(block.text, "utf8");
  transcript[current] = entry;
  expect(Buffer.byteLength(block.text, "utf8")).toBeLessThanOrEqual(
    coreLimits.maxPayloadBytes,
  );
  return {
    isError: result.isError === true,
    body: JSON.parse(block.text) as Record<string, unknown>,
  };
}

interface Record_ {
  readonly nodeId: string;
  readonly parentId?: string;
  readonly kind: string;
  readonly localName?: string;
  readonly namespaceUri?: string;
  readonly value?: string;
}

function textUnder(records: readonly Record_[], nodeId: string): string {
  return records
    .filter((record) => record.parentId === nodeId && record.kind === "text")
    .map((record) => record.value ?? "")
    .join("");
}

async function digest(root: string): Promise<Record<string, string>> {
  const entries = await readdir(root, { withFileTypes: true });
  const result: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(root, entry.name);
    const bytes = await readFile(path);
    const info = await stat(path);
    result[entry.name] = `${createHash("sha256").update(bytes).digest("hex")}:${String(info.mtimeMs)}`;
  }
  return result;
}

let before: Record<string, string>;

beforeAll(async () => {
  fixtures = inject("fixtures");
  before = await digest(fixtures.root);
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, fixtures.root],
  });
  client = new Client({ name: "xml-agent-scenarios", version: "0.0.0" });
  await client.connect(transport);
}, 40_000);

afterAll(async () => {
  await client.close();
});

describe("agent acceptance scenarios", () => {
  it("finds the right dependency version and not the same-name trap", async () => {
    current = "pom-dependency-version";
    const summary = await call("describe_document", { filePath: "pom.xml" });
    expect(summary.isError).toBe(false);
    const aliases = summary.body["namespaces"] as readonly {
      readonly uri: string;
      readonly alias: string;
    }[];
    expect(aliases.map((entry) => entry.uri)).toContain(namespaces.maven);

    const page = await call("read_node", {
      filePath: "pom.xml",
      address: [
        { namespaceUri: namespaces.maven, localName: "project" },
        { namespaceUri: namespaces.maven, localName: "dependencies" },
        { namespaceUri: namespaces.maven, localName: "dependency", occurrence: 2 },
      ],
      maxNodes: 50,
    });
    const records = page.body["records"] as readonly Record_[];
    const version = records.find(
      (record) =>
        record.kind === "element" &&
        record.localName === "version" &&
        record.namespaceUri === namespaces.maven,
    );
    expect(version).toBeDefined();
    expect(textUnder(records, version?.nodeId ?? "")).toBe("2.3.4");
    expect(JSON.stringify(records)).not.toContain("9.9.9");
  });

  it("returns invoice values as written, with no numeric rewriting", async () => {
    current = "invoice-line-values";
    const page = await call("read_node", {
      filePath: "invoice.xml",
      maxNodes: 200,
    });
    const records = page.body["records"] as readonly Record_[];
    const values = records
      .filter((record) => record.kind === "text")
      .map((record) => record.value);
    for (const expected of ["007", "0080", "10.50", "1234567890123456789"]) {
      expect(values).toContain(expected);
    }
    expect(values).not.toContain("7");
    expect(values).not.toContain("10.5");
  });

  it("reads the target framework from both a namespaced and a bare project", async () => {
    current = "legacy-target-framework";
    const legacy = await call("read_node", {
      filePath: "legacy.csproj",
      address: expectedTargetFrameworkAddress.legacy,
    });
    const legacyRecords = legacy.body["records"] as readonly Record_[];
    expect(textUnder(legacyRecords, legacyRecords[0]?.nodeId ?? "")).toBe(
      "net48",
    );

    const bare = await call("read_node", {
      filePath: "legacy.csproj",
      address: expectedTargetFrameworkAddress.modern,
    });
    expect(bare.isError).toBe(true);
    expect(bare.body["error"]).toBe("invalid_argument");

    current = "modern-target-framework";
    const modern = await call("read_node", {
      filePath: "modern.csproj",
      address: expectedTargetFrameworkAddress.modern,
    });
    const modernRecords = modern.body["records"] as readonly Record_[];
    expect(textUnder(modernRecords, modernRecords[0]?.nodeId ?? "")).toBe(
      "net9.0",
    );
  });

  it("keeps mixed-content order and spacing intact", async () => {
    current = "mixed-content-order";
    const page = await call("read_node", {
      filePath: "mixed.xml",
      maxNodes: 50,
    });
    const records = page.body["records"] as readonly Record_[];
    const shown = records
      .slice(1)
      .map((record) =>
        record.kind === "element" ? `<${String(record.localName)}>` : record.value,
      );
    expect(shown).toStrictEqual([
      "lead ",
      "<b>",
      "bold",
      " mid",
      'mode="fast"',
      " raw <tag> ",
      "remark",
      " tail ",
    ]);
  });

  it("explains a malformed document and stays usable afterwards", async () => {
    current = "malformed-recovery";
    const broken = await call("describe_document", {
      filePath: "malformed.xml",
    });
    expect(broken.isError).toBe(true);
    expect(broken.body["error"]).toBe("malformed_xml");
    expect(String(broken.body["recovery"]).length).toBeGreaterThan(0);
    expect(JSON.stringify(broken.body)).not.toContain(fixtures.root);

    const healthy = await call("describe_document", { filePath: "simple.xml" });
    expect(healthy.isError).toBe(false);
    expect((healthy.body["root"] as { localName: string }).localName).toBe(
      "catalog",
    );
  });

  it("names a document that really exists for every scenario", () => {
    for (const scenario of scenarios) {
      const name = files[scenario.file];
      expect(Object.keys(before)).toContain(name);
    }
  });

  it("reaches every answer within the call budget the manifest allows", () => {
    for (const scenario of scenarios) {
      const entry = transcript[scenario.id];
      if (entry === undefined) continue;
      expect(entry.calls).toBeLessThanOrEqual(scenario.maxCalls);
      expect(entry.bytes).toBeGreaterThan(0);
    }
  });

  it("changes no file on disk", async () => {
    expect(await digest(fixtures.root)).toStrictEqual(before);
  });
});
