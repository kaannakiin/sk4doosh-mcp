import { basename, join } from "node:path";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { SkMcpXmlError } from "../src/errors.js";
import { formats } from "../src/formats.js";
import { limits } from "../src/limits.js";
import {
  createDocumentRoot,
  resolveDocumentPath,
  type DocumentRoot,
} from "../src/paths.js";
import { createXmlMcpServer } from "../src/server.js";
import { createHandlers, toolNames, type ToolHandlers } from "../src/tools.js";
import { vocabulary } from "../src/vocabulary.js";

let root: DocumentRoot;
let handlers: ToolHandlers;
let fixtureRoot: string;

function payload(result: CallToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("the tool returned no text content");
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return (error as SkMcpXmlError).code;
  }
  return "no-error";
}

beforeAll(async () => {
  const fixtures = inject("fixtures");
  fixtureRoot = fixtures.root;
  root = await createDocumentRoot(fixtures.root);
  handlers = createHandlers(root);
});

describe("the registry is bound to XML", () => {
  it("resolves every allowlisted extension to one format", () => {
    expect(formats.names).toEqual(["xml"]);
    expect([...formats.extensions.keys()]).toEqual([
      ".xml",
      ".xsd",
      ".xhtml",
      ".svg",
      ".csproj",
      ".props",
      ".targets",
      ".config",
      ".resx",
    ]);
  });

  it("refuses an extension the server cannot read", async () => {
    expect(await codeOf(() => resolveDocumentPath(root, "book.xlsx"))).toBe(
      "unsupported_extension",
    );
  });

  it("speaks its own vocabulary in the shared messages", async () => {
    try {
      await resolveDocumentPath(root, "../outside.xml");
      expect.unreachable();
    } catch (error) {
      const failure = error as SkMcpXmlError;
      expect(failure).toBeInstanceOf(SkMcpXmlError);
      expect(failure.message).toContain(vocabulary.rootLabel);
    }
  });

  it("points recovery at its own list tool", async () => {
    try {
      await resolveDocumentPath(root, "missing.xml");
      expect.unreachable();
    } catch (error) {
      expect((error as SkMcpXmlError).recovery).toContain("list_documents");
    }
  });
});

describe("list_documents", () => {
  it("lists candidates without parsing them", async () => {
    const result = await handlers.list_documents({});
    const body = payload(result);
    const files = body["files"] as { filePath: string }[];
    const names = files.map((file) => basename(file.filePath)).sort();
    expect(names).toContain("malformed.xml");
    expect(names).toContain("doctype.xml");
    expect(result.isError).toBeUndefined();
  });

  it("keeps scan completeness separate from page truncation", async () => {
    const body = payload(await handlers.list_documents({ maxResults: 1 }));
    expect(body["totalExact"]).toBe(true);
    expect(body["scanTruncated"]).toBe(false);
    expect(body["truncated"]).toBe(true);
    expect((body["files"] as unknown[]).length).toBe(1);
  });

  it("descends into subdirectories", async () => {
    const body = payload(
      await handlers.list_documents({ pattern: "**/*.svg" }),
    );
    expect((body["files"] as unknown[]).length).toBe(1);
  });

  it("stays inside the payload budget", async () => {
    const result = await handlers.list_documents({});
    const first = result.content[0] as { text: string };
    expect(Buffer.byteLength(first.text, "utf8")).toBeLessThanOrEqual(
      limits.maxPayloadBytes,
    );
  });
});

describe("the sandbox holds for XML shapes", () => {
  it("refuses a directory that carries a readable extension", async () => {
    const trap = join(fixtureRoot, "trap.xml");
    await mkdir(trap, { recursive: true });
    const code = await codeOf(async () => {
      const resolved = await resolveDocumentPath(root, "trap.xml");
      const { createXmlWorkerPool } = await import("../src/worker-pool.js");
      const { createXmlDocumentCache } = await import("../src/document.js");
      const pool = createXmlWorkerPool();
      try {
        await createXmlDocumentCache(pool, root.real).load(resolved);
      } finally {
        await pool.close();
      }
    });
    expect(code).toBe("not_a_file");
  });

  it("refuses a symlink that escapes the root", async () => {
    const outside = join(fixtureRoot, "..", "xml-mcp-escape.xml");
    await writeFile(outside, "<r/>", "utf8");
    const link = join(fixtureRoot, "escape.xml");
    await symlink(outside, link).catch(() => undefined);
    expect(await codeOf(() => resolveDocumentPath(root, "escape.xml"))).toBe(
      "path_outside_root",
    );
  });
});

describe("the MCP surface", () => {
  it("registers exactly the declared read-only tools", async () => {
    const server = createXmlMcpServer(root);
    const client = new Client({ name: "xml-spec", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const listed = (await client.listTools()).tools;
    expect(listed.map((tool) => tool.name).sort()).toEqual(
      [...toolNames].sort(),
    );
    expect(
      listed.every((tool) => tool.annotations?.readOnlyHint === true),
    ).toBe(true);
    expect(
      listed.every((tool) => tool.annotations?.openWorldHint === false),
    ).toBe(true);

    const called = await client.callTool({
      name: "list_documents",
      arguments: {},
    });
    expect(called.isError).toBeUndefined();

    await client.close();
    await server.close();
  });
});
