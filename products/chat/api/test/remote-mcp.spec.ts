import { afterEach, describe, expect, it } from "vitest";

import { listTools } from "../src/connections/remote-mcp.client.ts";
import { mcpStub } from "./mcp-stub.ts";
import { startStub, type Stub } from "./oauth-stub.ts";

const TOOLS = [
  { name: "orders_me", description: "Your orders" },
  { name: "orders.create", inputSchema: { type: "object", required: ["id"] } },
];

const TRANSPORT = {
  endpoint: { allowLoopback: true },
  timeoutMs: 5_000,
  maxBytes: 64 * 1024,
};

describe("listTools", () => {
  let stub: Stub | undefined;

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  it("performs the handshake before listing", async () => {
    const server = mcpStub({ tools: TOOLS });
    server.state.accessToken = "at-1";
    stub = await startStub(server.handler);

    const listed = await listTools({
      url: `${stub.origin}/mcp`,
      accessToken: "at-1",
      ...TRANSPORT,
    });

    expect(listed).toMatchObject({ kind: "ok" });
    expect(
      stub.calls
        .filter(({ path }) => path === "/mcp")
        .map(({ body }) => (JSON.parse(body) as { method: string }).method),
    ).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });

  it("carries the session id the server issued", async () => {
    const server = mcpStub({ tools: TOOLS });
    server.state.accessToken = "at-1";
    stub = await startStub(server.handler);

    await listTools({
      url: `${stub.origin}/mcp`,
      accessToken: "at-1",
      ...TRANSPORT,
    });

    const [initialize, ...rest] = stub.calls.filter(
      ({ path }) => path === "/mcp",
    );

    expect(initialize?.headers["mcp-session-id"]).toBeUndefined();
    for (const call of rest) {
      expect(call.headers["mcp-session-id"]).toBe("stub-session");
    }
  });

  /**
   * Guard: MCP's streamable http transport lets a server answer a plain request
   * with an event stream, and reading that body as json would report a
   * conforming server as malformed.
   */
  it("reads a reply the server sent as an event stream", async () => {
    const server = mcpStub({ tools: TOOLS, eventStream: true });
    server.state.accessToken = "at-1";
    stub = await startStub(server.handler);

    const listed = await listTools({
      url: `${stub.origin}/mcp`,
      accessToken: "at-1",
      ...TRANSPORT,
    });

    expect(listed).toMatchObject({
      kind: "ok",
      value: [{ name: "orders_me" }, { name: "orders.create" }],
    });
  });

  it("follows the cursor to the end", async () => {
    const server = mcpStub({ tools: TOOLS, pageSize: 1 });
    server.state.accessToken = "at-1";
    stub = await startStub(server.handler);

    const listed = await listTools({
      url: `${stub.origin}/mcp`,
      accessToken: "at-1",
      ...TRANSPORT,
    });

    expect(listed).toMatchObject({ kind: "ok" });
    expect(listed.kind === "ok" ? listed.value : []).toHaveLength(2);
    expect(server.state.toolListings).toEqual([
      { cursor: undefined },
      { cursor: "1" },
    ]);
  });

  /**
   * Guard: a server that always answers with a cursor would otherwise hold this
   * request open for as long as it cared to.
   */
  it("gives up on a server whose cursor never ends", async () => {
    stub = await startStub((call) => {
      if (call.body === "") {
        return { status: 202 };
      }

      const request = JSON.parse(call.body) as { id?: unknown; method: string };
      if (request.method === "notifications/initialized") {
        return { status: 202 };
      }

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "initialize"
              ? {}
              : { tools: [], nextCursor: "more" },
        }),
      };
    });

    await expect(
      listTools({
        url: `${stub.origin}/mcp`,
        accessToken: "at-1",
        ...TRANSPORT,
      }),
    ).resolves.toMatchObject({ kind: "failed", failure: "malformed" });
  });

  /**
   * Guard: a server that needs no credential still parses what it is given, and
   * `Bearer undefined` is a credential it has every reason to refuse.
   */
  it("sends no authorization header when there is no token", async () => {
    stub = await startStub(mcpStub({ tools: TOOLS, open: true }).handler);

    const listed = await listTools({
      url: `${stub.origin}/mcp`,
      accessToken: undefined,
      ...TRANSPORT,
    });

    expect(listed.kind).toBe("ok");
    for (const call of stub.calls) {
      expect(call.headers["authorization"]).toBeUndefined();
    }
  });

  it("sends the header when there is a token", async () => {
    const server = mcpStub({ tools: TOOLS });
    server.state.accessToken = "at-1";
    stub = await startStub(server.handler);

    await listTools({
      url: `${stub.origin}/mcp`,
      accessToken: "at-1",
      ...TRANSPORT,
    });

    for (const call of stub.calls) {
      expect(call.headers["authorization"]).toBe("Bearer at-1");
    }
  });

  it("reports a rejected token apart from every other failure", async () => {
    const server = mcpStub({ tools: TOOLS });
    server.state.accessToken = "at-1";
    stub = await startStub(server.handler);

    await expect(
      listTools({
        url: `${stub.origin}/mcp`,
        accessToken: "stale",
        ...TRANSPORT,
      }),
    ).resolves.toMatchObject({ kind: "failed", failure: "unauthorized" });
  });

  /**
   * Guard: every request here carries the user's bearer token, so a `302` would
   * replay it to whatever host the response named.
   */
  it("does not follow a redirect", async () => {
    stub = await startStub((_call, origin) => ({
      status: 302,
      headers: { location: `${origin}/elsewhere` },
    }));

    const listed = await listTools({
      url: `${stub.origin}/mcp`,
      accessToken: "at-1",
      ...TRANSPORT,
    });

    expect(listed).toMatchObject({ kind: "failed" });
    expect(stub.calls.map(({ path }) => path)).toEqual(["/mcp"]);
  });

  /**
   * Guard: one entry a server wrote badly must not hide every good one.
   */
  it("drops a tool that does not parse and keeps the rest", async () => {
    stub = await startStub((call) => {
      const request = JSON.parse(call.body) as { id?: unknown; method: string };
      if (request.method === "notifications/initialized") {
        return { status: 202 };
      }

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "initialize"
              ? {}
              : {
                  tools: [
                    { name: "not a valid name", inputSchema: {} },
                    { name: "good_tool", inputSchema: { type: "object" } },
                  ],
                },
        }),
      };
    });

    await expect(
      listTools({
        url: `${stub.origin}/mcp`,
        accessToken: "at-1",
        ...TRANSPORT,
      }),
    ).resolves.toMatchObject({ kind: "ok", value: [{ name: "good_tool" }] });
  });
});
