import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { readOnly } from "@sk-mcp/mcp-core";
import { describe, expect, it } from "vitest";
import type { BackendProbe, QueuedBackend } from "../src/backend/port.js";
import { createLlmMcpServer } from "../src/server.js";

function fakeBackend(probe: BackendProbe, pending = 0): QueuedBackend {
  return {
    model: "qwen3:8b",
    contextTokens: 16_384,
    pending,
    complete: () => Promise.reject(new Error("not used")),
    probe: () => Promise.resolve(probe),
    warm: () => Promise.resolve(),
  };
}

async function connect(backend: QueuedBackend): Promise<Client> {
  const server = createLlmMcpServer(backend);
  const client = new Client({ name: "llm-spec", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function body(result: CallToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("the tool returned no text content");
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

describe("createLlmMcpServer", () => {
  it("lists local_status as a read-only tool", async () => {
    const client = await connect(
      fakeBackend({ reachable: true, loaded: true }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["local_status"]);
    expect(tools[0]?.annotations).toMatchObject(readOnly);
  });

  it("reports the host, the window, the budget and the queue", async () => {
    const client = await connect(
      fakeBackend({ reachable: true, loaded: true }, 3),
    );
    const result = (await client.callTool({
      name: "local_status",
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBeUndefined();
    expect(body(result)).toEqual({
      model: "qwen3:8b",
      reachable: true,
      loaded: true,
      contextTokens: 16_384,
      inputBudgetTokens: 7_372,
      queued: 3,
    });
  });

  it("answers with reachable false instead of an error when the host is down", async () => {
    const client = await connect(
      fakeBackend({ reachable: false, detail: "fetch failed" }),
    );
    const result = (await client.callTool({
      name: "local_status",
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBeUndefined();
    expect(body(result)).toMatchObject({
      reachable: false,
      detail: "fetch failed",
    });
  });
});
