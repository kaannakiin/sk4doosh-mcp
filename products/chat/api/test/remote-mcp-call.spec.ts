import { afterEach, describe, expect, it } from "vitest";

import { McpSession, callTool } from "../src/connections/remote-mcp.client.ts";
import { mcpStub } from "./mcp-stub.ts";
import { startStub, type Stub } from "./oauth-stub.ts";

const TOOLS = [{ name: "list_zones", description: "Lists zones" }];

const TRANSPORT = {
  endpoint: { allowLoopback: true },
  timeoutMs: 5_000,
  maxBytes: 64 * 1024,
};

describe("callTool", () => {
  let stub: Stub | undefined;

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  it("sends the remote name and the model's arguments", async () => {
    const server = mcpStub({ open: true, tools: TOOLS });
    stub = await startStub(server.handler);

    const called = await callTool(
      new McpSession({
        url: `${stub.origin}/mcp`,
        accessToken: undefined,
        ...TRANSPORT,
      }),
      "list_zones",
      { page: 2 },
    );

    expect(called).toMatchObject({ kind: "ok" });
    expect(server.state.calls).toEqual([
      { name: "list_zones", args: { page: 2 } },
    ]);
  });

  it("handshakes once for two calls on the same session", async () => {
    const server = mcpStub({ open: true, tools: TOOLS });
    stub = await startStub(server.handler);
    const session = new McpSession({
      url: `${stub.origin}/mcp`,
      accessToken: undefined,
      ...TRANSPORT,
    });

    await callTool(session, "list_zones", {});
    await callTool(session, "list_zones", {});

    expect(server.state.handshakes).toHaveLength(1);
    expect(server.state.calls).toHaveLength(2);
  });

  it("carries isError back rather than failing", async () => {
    const server = mcpStub({ open: true, tools: TOOLS, callIsError: true });
    stub = await startStub(server.handler);

    const called = await callTool(
      new McpSession({
        url: `${stub.origin}/mcp`,
        accessToken: undefined,
        ...TRANSPORT,
      }),
      "list_zones",
      {},
    );

    expect(called).toMatchObject({ kind: "ok" });
    expect(called.kind === "ok" && called.value.isError).toBe(true);
    expect(called.kind === "ok" && called.value.blocks).toHaveLength(1);
  });

  it("re-handshakes exactly once when the server drops the session", async () => {
    const server = mcpStub({ open: true, tools: TOOLS, sessionExpires: true });
    stub = await startStub(server.handler);
    const session = new McpSession({
      url: `${stub.origin}/mcp`,
      accessToken: undefined,
      ...TRANSPORT,
    });

    const called = await callTool(session, "list_zones", {});

    expect(called).toMatchObject({ kind: "ok" });
    expect(server.state.handshakes).toHaveLength(2);
  });

  it("reports an answer larger than the ceiling as too_large", async () => {
    const server = mcpStub({
      open: true,
      tools: TOOLS,
      callBodyBytes: 4096,
    });
    stub = await startStub(server.handler);

    const called = await callTool(
      new McpSession({
        url: `${stub.origin}/mcp`,
        accessToken: undefined,
        ...TRANSPORT,
        maxBytes: 1024,
      }),
      "list_zones",
      {},
    );

    expect(called).toMatchObject({ kind: "failed", failure: "too_large" });
  });

  it("reads a call answered as an event stream", async () => {
    const server = mcpStub({ open: true, tools: TOOLS, eventStream: true });
    stub = await startStub(server.handler);

    const called = await callTool(
      new McpSession({
        url: `${stub.origin}/mcp`,
        accessToken: undefined,
        ...TRANSPORT,
      }),
      "list_zones",
      {},
    );

    expect(called).toMatchObject({ kind: "ok" });
  });

  it("reports a guarded server with no token as unauthorized", async () => {
    const server = mcpStub({ tools: TOOLS });
    server.state.accessToken = "at-1";
    stub = await startStub(server.handler);

    const called = await callTool(
      new McpSession({
        url: `${stub.origin}/mcp`,
        accessToken: undefined,
        ...TRANSPORT,
      }),
      "list_zones",
      {},
    );

    expect(called).toMatchObject({ kind: "failed", failure: "unauthorized" });
  });
});
