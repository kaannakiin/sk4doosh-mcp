import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  McpSourceError,
  internalErrorMessage,
  internalErrorRecovery,
  type SourceErrorCode,
  type ErrorContext,
  type ErrorFactory,
} from "../src/errors.js";
import { createMcpSourceServer, toolNamesOf } from "../src/server.js";
import {
  guard,
  json,
  readOnly,
  type HandlersOf,
  type ToolDefinitions,
} from "../src/tools.js";
import type { Vocabulary } from "../src/vocabulary.js";

const vocabulary: Vocabulary<string> = {
  serverName: "probe-mcp",
  subject: "document",
  listTool: "list_documents",
};

const fail: ErrorFactory<SourceErrorCode> = (code, message, recovery) =>
  new McpSourceError(code, message, recovery);

function normalize(error: unknown, context: ErrorContext): McpSourceError {
  if (error instanceof McpSourceError) {
    return error;
  }
  return fail(
    "internal_error",
    internalErrorMessage(error, context),
    internalErrorRecovery(vocabulary),
  );
}

const definitions = {
  list_documents: {
    description: "List the readable documents under the root.",
    inputSchema: z.object({ pattern: z.string().optional() }),
    annotations: readOnly,
  },
  read_document: {
    description: "Read one document.",
    inputSchema: z.object({ filePath: z.string() }),
    annotations: readOnly,
  },
  break_document: {
    description: "Throw something the server does not classify.",
    inputSchema: z.object({}),
    annotations: readOnly,
  },
} as const satisfies ToolDefinitions;

type Definitions = typeof definitions;

const handlers: HandlersOf<Definitions> = {
  list_documents: guard<Definitions, "list_documents">(
    { tool: "list_documents", fail },
    async (args) => json({ pattern: args.pattern ?? "*" }),
    normalize,
  ),
  read_document: guard<Definitions, "read_document">(
    { tool: "read_document", fail },
    async (args) => {
      if (args.filePath === "missing.probe") {
        throw fail(
          "invalid_argument",
          "No such document.",
          "Call list_documents.",
        );
      }
      return json({ filePath: args.filePath });
    },
    normalize,
  ),
  break_document: guard<Definitions, "break_document">(
    { tool: "break_document", fail },
    async () => {
      throw new TypeError("x is not a function");
    },
    normalize,
  ),
};

function body(result: CallToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("the tool returned no text content");
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

let client: Client;

beforeAll(async () => {
  const server = createMcpSourceServer(
    { name: "probe-mcp", version: "9.9.9" },
    definitions,
    handlers,
  );
  client = new Client({ name: "probe-spec", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
});

describe("createMcpSourceServer", () => {
  it("registers exactly the declared tools, derived from the definitions", async () => {
    const listed = (await client.listTools()).tools;
    expect(listed.map((tool) => tool.name).sort()).toEqual(
      [...toolNamesOf(definitions)].sort(),
    );
  });

  it("lists the tools in definition order on every call", async () => {
    const first = (await client.listTools()).tools.map((tool) => tool.name);
    const second = (await client.listTools()).tools.map((tool) => tool.name);
    expect(first).toEqual([...toolNamesOf(definitions)]);
    expect(second).toEqual(first);
  });

  it("reports the identity it was given", () => {
    expect(client.getServerVersion()).toEqual({
      name: "probe-mcp",
      version: "9.9.9",
    });
  });

  it("carries the read-only annotations over the wire", async () => {
    const listed = (await client.listTools()).tools;
    expect(
      listed.every(
        (tool) =>
          tool.annotations?.readOnlyHint === true &&
          tool.annotations?.idempotentHint === true &&
          tool.annotations?.openWorldHint === false,
      ),
    ).toBe(true);
  });

  it("passes validated arguments through to the handler", async () => {
    const result = await client.callTool({
      name: "list_documents",
      arguments: { pattern: "*.probe" },
    });
    expect(body(result as CallToolResult)).toEqual({ pattern: "*.probe" });
  });

  it("refuses arguments the schema does not accept before the handler runs", async () => {
    const result = (await client.callTool({
      name: "read_document",
      arguments: {},
    })) as CallToolResult;
    const first = result.content[0];
    expect(result.isError).toBe(true);
    expect(first?.type).toBe("text");
    expect(String(first?.type === "text" ? first.text : "")).toContain(
      "Input validation error",
    );
  });

  it("keeps a shape failure out of the structured error envelope", async () => {
    const result = (await client.callTool({
      name: "read_document",
      arguments: {},
    })) as CallToolResult;
    const first = result.content[0];
    const text = first?.type === "text" ? first.text : "";
    expect(() => JSON.parse(text)).toThrow();
  });
});

describe("the guard", () => {
  it("turns a classified failure into the error envelope", async () => {
    const result = (await client.callTool({
      name: "read_document",
      arguments: { filePath: "missing.probe" },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(body(result)).toEqual({
      error: "invalid_argument",
      message: "No such document.",
      recovery: "Call list_documents.",
    });
  });

  it("turns an unclassified throw into internal_error and blames the server", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const result = (await client.callTool({
      name: "break_document",
      arguments: {},
    })) as CallToolResult;
    const written = stderr.mock.calls.map((call) => String(call[0])).join("");
    stderr.mockRestore();

    expect(result.isError).toBe(true);
    const envelope = body(result);
    expect(envelope["error"]).toBe("internal_error");
    expect(envelope["message"]).toContain("break_document failed unexpectedly");
    expect(envelope["recovery"]).toContain("probe-mcp server");
    expect(written).toContain("break_document:");
    expect(written).toContain("x is not a function");
  });

  it("omits recovery when the failure carries none", async () => {
    const bare = fail("invalid_argument", "plain");
    expect(bare.recovery).toBeUndefined();
  });
});
