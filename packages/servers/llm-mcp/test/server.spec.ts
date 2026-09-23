import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownOutput, readOnly } from "@sk-mcp/mcp-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BackendProbe, QueuedBackend } from "../src/backend/port.js";
import { fail } from "../src/platform/errors.js";
import { openWorkspace, type Workspace } from "../src/platform/workspace.js";
import { createLlmMcpServer } from "../src/server.js";

let base: string;
let workspace: Workspace;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "llm-mcp-server-")));
  await writeFile(join(base, "note.txt"), "Ayşe geldi.");
  workspace = await openWorkspace(base, fail);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

function fakeBackend(probe: BackendProbe, pending = 0): QueuedBackend {
  return {
    model: "qwen3:8b",
    contextTokens: 16_384,
    pending,
    complete: () =>
      Promise.resolve({
        text: '{"people":["Ayşe"]}',
        promptTokens: 30,
        outputTokens: 6,
        durationMs: 9,
      }),
    probe: () => Promise.resolve(probe),
    warm: () => Promise.resolve(),
  };
}

async function connect(backend: QueuedBackend): Promise<Client> {
  const server = createLlmMcpServer(backend, workspace);
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
  it("declares local_map as an own-output tool and the rest read-only", async () => {
    const client = await connect(
      fakeBackend({ reachable: true, loaded: true }),
    );
    const { tools } = await client.listTools();
    const hints = Object.fromEntries(
      tools.map((tool) => [tool.name, tool.annotations]),
    );
    expect(Object.keys(hints)).toEqual([
      "local_status",
      "local_task",
      "local_map",
    ]);
    expect(hints["local_status"]).toMatchObject(readOnly);
    expect(hints["local_task"]).toMatchObject(readOnly);
    expect(hints["local_map"]).toMatchObject(ownOutput);
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

  it("runs a local task over the transport", async () => {
    const client = await connect(
      fakeBackend({ reachable: true, loaded: true }),
    );
    const result = (await client.callTool({
      name: "local_task",
      arguments: {
        kind: "extract",
        instruction: "List the people.",
        files: ["note.txt"],
        jsonSchema: { type: "object" },
      },
    })) as CallToolResult;
    expect(result.isError).toBeUndefined();
    expect(body(result)).toMatchObject({
      kind: "extract",
      result: { people: ["Ayşe"] },
    });
  });

  it("keeps the absolute workspace root out of an error", async () => {
    const client = await connect(
      fakeBackend({ reachable: true, loaded: true }),
    );
    const result = (await client.callTool({
      name: "local_task",
      arguments: {
        kind: "extract",
        instruction: "x",
        files: [join(base, "..", "outside.txt")],
      },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(body(result)["error"]).toBe("outside_workspace");
    expect(JSON.stringify(body(result))).not.toContain(base);
  });
});
