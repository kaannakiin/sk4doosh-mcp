import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { coreLimits } from "@sk-mcp/file-core";
import { afterEach, describe, expect, inject, it } from "vitest";
import type { Fixtures } from "./fixtures/build.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../dist/cli.js");

interface CacheableListResult {
  readonly tools: readonly { readonly name: string }[];
  readonly ttlMs?: number;
  readonly cacheScope?: string;
}

let open: Client | undefined;

async function connect(options?: ConstructorParameters<typeof Client>[1]) {
  const fixtures: Fixtures = inject("fixtures");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, fixtures.root],
  });
  const client = new Client(
    { name: "xml-protocol-era", version: "0.0.0" },
    options,
  );
  await client.connect(transport);
  open = client;
  return client;
}

afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe("protocol era", () => {
  it("serves a 2025-era client, which carries no cache fields", async () => {
    const client = await connect();
    expect(client.getProtocolEra()).toBe("legacy");
    const listed = (await client.request({
      method: "tools/list",
      params: {},
    })) as CacheableListResult;
    expect(listed.ttlMs).toBeUndefined();
    expect(listed.cacheScope).toBeUndefined();
  }, 40_000);

  it("serves a negotiating client on 2026-07-28 with the public catalogue hint", async () => {
    const client = await connect({ versionNegotiation: { mode: "auto" } });
    expect(client.getProtocolEra()).toBe("modern");
    const listed = (await client.request({
      method: "tools/list",
      params: {},
    })) as CacheableListResult;
    expect(listed.ttlMs).toBe(coreLimits.catalogTtlMs);
    expect(listed.cacheScope).toBe("public");
  }, 40_000);

  it("publishes the same catalogue on both eras", async () => {
    const legacy = (await (await connect()).listTools()).tools.map(
      (t) => t.name,
    );
    await open?.close();
    open = undefined;
    const modern = (
      await (
        await connect({ versionNegotiation: { mode: "auto" } })
      ).listTools()
    ).tools.map((t) => t.name);
    expect(modern).toEqual(legacy);
  }, 60_000);
});
