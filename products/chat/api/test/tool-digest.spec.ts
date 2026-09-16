import type { RemoteTool } from "@chat/contracts/integration/remote-tool";
import { describe, expect, it } from "vitest";

import { toolDefinitionDigest } from "../src/connections/tool-digest.ts";

function tool(overrides: Partial<RemoteTool> = {}): RemoteTool {
  return {
    name: "list_zones",
    description: "Lists the zones on the account.",
    inputSchema: { type: "object", properties: { page: { type: "number" } } },
    ...overrides,
  };
}

const hex = (value: RemoteTool): string =>
  toolDefinitionDigest(value).toString("hex");

describe("toolDefinitionDigest", () => {
  it("is 32 bytes, which is what both columns require", () => {
    expect(toolDefinitionDigest(tool())).toHaveLength(32);
  });

  it("does not depend on the order the server serialized its schema in", () => {
    const first = tool({
      inputSchema: { type: "object", a: { type: "string" }, b: { type: "string" } },
    });
    const second = tool({
      inputSchema: { type: "object", b: { type: "string" }, a: { type: "string" } },
    });

    expect(hex(first)).toBe(hex(second));
  });

  it("survives the integer-key reordering that json round trips introduce", () => {
    const written = tool({
      inputSchema: {
        type: "object",
        properties: { "2": { type: "string" }, a: { type: "string" }, "1": { type: "string" } },
      },
    });
    const readBack = JSON.parse(JSON.stringify(written)) as RemoteTool;

    expect(hex(readBack)).toBe(hex(written));
  });

  it("ignores the title, which is display only", () => {
    expect(hex(tool({ title: "Zones" }))).toBe(hex(tool({ title: "zones" })));
  });

  it("changes when the description changes", () => {
    expect(hex(tool({ description: "Lists the zones, and mails them." }))).not.toBe(
      hex(tool()),
    );
  });

  it("changes when the input schema changes", () => {
    expect(
      hex(tool({ inputSchema: { type: "object", properties: {} } })),
    ).not.toBe(hex(tool()));
  });

  it("changes when an annotation changes", () => {
    expect(hex(tool({ annotations: { readOnlyHint: true } }))).not.toBe(
      hex(tool({ annotations: { readOnlyHint: false } })),
    );
    expect(hex(tool({ annotations: {} }))).not.toBe(hex(tool()));
  });

  it("treats a reordered array as a change", () => {
    expect(
      hex(tool({ inputSchema: { type: "object", required: ["a", "b"] } })),
    ).not.toBe(hex(tool({ inputSchema: { type: "object", required: ["b", "a"] } })));
  });

  it("separates a name from a description that would otherwise run together", () => {
    expect(hex(tool({ name: "a_b", description: undefined }))).not.toBe(
      hex(tool({ name: "a", description: "b" })),
    );
  });
});
