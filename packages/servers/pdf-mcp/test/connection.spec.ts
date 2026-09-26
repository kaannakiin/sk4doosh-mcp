import { createRequire } from "node:module";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { describe, expect, inject, it } from "vitest";
import { createDocumentRoot } from "../src/platform/paths.js";
import { createPdfMcpServer } from "../src/server.js";
import { toolNames } from "../src/tools/definitions.js";

const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

async function connect(): Promise<Client> {
  const server = createPdfMcpServer(
    await createDocumentRoot(inject("fixtures").root),
  );
  const client = new Client({ name: "pdf-spec", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function payload(result: CallToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("the tool returned no text content");
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

describe("protocol surface", () => {
  it("registers exactly the declared tools and identifies itself", async () => {
    const client = await connect();
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toStrictEqual(
        [...toolNames].sort(),
      );
      expect(client.getServerVersion()).toMatchObject({
        name: "liaiso-pdf",
        version: manifest.version,
      });
    } finally {
      await client.close();
    }
  });

  it("annotates every tool as read-only", async () => {
    const client = await connect();
    try {
      const listed = await client.listTools();
      for (const tool of listed.tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
      }
    } finally {
      await client.close();
    }
  });

  it("answers a real call over the transport", async () => {
    const client = await connect();
    try {
      const result = (await client.callTool({
        name: "read_pages",
        arguments: { filePath: "text.pdf", pages: [1] },
      })) as CallToolResult;
      expect(result.isError).not.toBe(true);
      const body = payload(result);
      const pages = body["pages"] as { page: number; markdown: string }[];
      expect(pages[0]?.page).toBe(1);
      expect(pages[0]?.markdown).toContain("2026-0917");
    } finally {
      await client.close();
    }
  });
});
