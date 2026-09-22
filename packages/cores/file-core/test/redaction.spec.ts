import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createMcpSourceServer,
  readOnly,
  type ToolDefinitions,
} from "@sk-mcp/mcp-core";
import {
  FileSourceError,
  type CoreErrorCode,
  type ErrorFactory,
} from "../src/errors.js";
import { guard, toToolError } from "../src/tools.js";

const fail: ErrorFactory<CoreErrorCode> = (code, message, recovery) =>
  new FileSourceError(code, message, recovery);

const normalize = (error: unknown): FileSourceError =>
  error instanceof FileSourceError ? error : fail("internal_error", "boom");

const definitions = {
  read_document: {
    description: "Read one document.",
    inputSchema: z.object({}),
    annotations: readOnly,
  },
} as const satisfies ToolDefinitions;

type Definitions = typeof definitions;

interface TextResult {
  readonly content: readonly unknown[];
  readonly isError?: boolean;
}

function envelopeOf(result: TextResult): Record<string, string> {
  const first = result.content[0] as { type: string; text: string };
  return JSON.parse(first.text) as Record<string, string>;
}

describe("the file redactor", () => {
  it("rewrites a path under the root to a root-relative one", () => {
    const result = toToolError(
      fail("file_not_found", "'/data/reports/q1.probe' is missing."),
      { root: "/data" },
    );
    expect(envelopeOf(result)["message"]).toBe(
      "'reports/q1.probe' is missing.",
    );
  });

  it("replaces a path outside the root rather than disclosing it", () => {
    const result = toToolError(fail("not_a_file", "'/etc/shadow' is odd."), {
      root: "/data",
    });
    expect(envelopeOf(result)["message"]).toBe("'[path]' is odd.");
  });

  it("redacts the recovery line too", () => {
    const result = toToolError(
      fail("file_not_found", "Missing.", "Look under /data/private instead."),
      { root: "/data" },
    );
    expect(envelopeOf(result)["recovery"]).toBe("Look under private instead.");
  });

  it("leaves a message with no path untouched", () => {
    const result = toToolError(fail("invalid_argument", "pattern is empty."), {
      root: "/data",
    });
    expect(envelopeOf(result)["message"]).toBe("pattern is empty.");
  });
});

describe("the redactor the guard binds", () => {
  let client: Client;

  beforeAll(async () => {
    const server = createMcpSourceServer(
      { name: "probe-mcp", version: "9.9.9" },
      definitions,
      {
        read_document: guard<Definitions, "read_document">(
          { tool: "read_document", root: "/data", fail },
          async () => {
            throw fail(
              "file_not_found",
              "'/elsewhere/secret.probe' is missing.",
            );
          },
          normalize,
        ),
      },
    );
    client = new Client({ name: "redaction-spec", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  it("keeps a thrown path out of the envelope the agent receives", async () => {
    const result = (await client.callTool({
      name: "read_document",
      arguments: {},
    })) as TextResult;
    expect(result.isError).toBe(true);
    expect(envelopeOf(result)["message"]).toBe("'[path]' is missing.");
  });
});
