import { describe, expect, it } from "vitest";

import {
  decodeSessionCursor,
  encodeSessionCursor,
} from "../src/chat/session-cursor.ts";

const ID = "7f1d2c3b-4a5e-4f60-8a9b-0c1d2e3f4a5b";

function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

describe("session cursor", () => {
  it("round-trips an opened-at keyset position", () => {
    const cursor = { openedAt: "2026-09-26T08:30:00.000Z", id: ID };

    expect(decodeSessionCursor(encodeSessionCursor(cursor))).toEqual(cursor);
  });

  it("restarts the listing for a cursor minted before the sort key changed", () => {
    const legacy = base64Url({ updatedAt: "2026-09-20T10:00:00.000Z", id: ID });

    expect(decodeSessionCursor(legacy)).toBeUndefined();
  });

  it("rejects text that is not base64url", () => {
    expect(decodeSessionCursor("not a cursor!")).toBeUndefined();
  });
});
