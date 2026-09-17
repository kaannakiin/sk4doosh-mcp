import { isExposedToolName } from "@chat/contracts/chat/exposed-tool-name";
import { describe, expect, it } from "vitest";

import {
  exposedToolNameFor,
  resolveToolNames,
} from "../src/connections/remote-tool-names.ts";

const CLOUDFLARE = "3f1b0c4e-0000-4000-8000-000000000001";

const SOLANA = "3f1b0c4e-0000-4000-8000-000000000002";

describe("exposedToolNameFor", () => {
  it("is deterministic", () => {
    expect(exposedToolNameFor(CLOUDFLARE, "list_zones")).toBe(
      exposedToolNameFor(CLOUDFLARE, "list_zones"),
    );
  });

  it("separates the same tool name on two servers", () => {
    expect(exposedToolNameFor(CLOUDFLARE, "search")).not.toBe(
      exposedToolNameFor(SOLANA, "search"),
    );
  });

  it("produces a name a provider accepts", () => {
    const names = [
      "list_zones",
      "Zones.List",
      "get-documentation",
      "ÜST",
      "a".repeat(128),
      "_",
      "...",
      "1",
    ].map((remote) => exposedToolNameFor(CLOUDFLARE, remote));

    for (const name of names) {
      expect(isExposedToolName(name)).toBe(true);
    }
  });

  it("keeps two names apart when they differ only past the truncation point", () => {
    const left = `${"a".repeat(60)}_left`;
    const right = `${"a".repeat(60)}_right`;

    expect(exposedToolNameFor(CLOUDFLARE, left)).not.toBe(
      exposedToolNameFor(CLOUDFLARE, right),
    );
  });

  it("keeps two names apart when they differ only in punctuation", () => {
    expect(exposedToolNameFor(CLOUDFLARE, "get.docs")).not.toBe(
      exposedToolNameFor(CLOUDFLARE, "get-docs"),
    );
    expect(exposedToolNameFor(CLOUDFLARE, "get_docs")).not.toBe(
      exposedToolNameFor(CLOUDFLARE, "get.docs"),
    );
  });

  it("leaves an already conforming name readable", () => {
    expect(exposedToolNameFor(CLOUDFLARE, "list_zones")).toMatch(
      /^i[0-9a-f]{8}_list_zones$/u,
    );
  });
});

describe("resolveToolNames", () => {
  it("indexes each tool under the name the model will use", () => {
    const tools = [
      { integrationPublicId: CLOUDFLARE, remoteName: "list_zones" },
      { integrationPublicId: SOLANA, remoteName: "list_zones" },
    ];

    const { byExposedName, conflicts } = resolveToolNames(tools);

    expect(byExposedName.size).toBe(2);
    expect(conflicts).toHaveLength(0);
    expect(byExposedName.get(exposedToolNameFor(SOLANA, "list_zones"))).toBe(
      tools[1],
    );
  });

  it("refuses a collision rather than renumbering it", () => {
    const tools = [
      { integrationPublicId: CLOUDFLARE, remoteName: "list_zones" },
      { integrationPublicId: CLOUDFLARE, remoteName: "list_zones" },
    ];

    const { byExposedName, conflicts } = resolveToolNames(tools);

    expect(byExposedName.size).toBe(1);
    expect(conflicts).toEqual([tools[1]]);
  });
});
