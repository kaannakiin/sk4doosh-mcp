import { createHash } from "node:crypto";
import {
  decodeCursorPayload,
  encodeCursor,
  isFresh,
  type Cursor,
  type Fingerprint,
} from "@sk-mcp/file-core";
import { SkMcpXmlError } from "./errors.js";
import { limits } from "./limits.js";
import type { NodePath } from "./node-model.js";

export type CursorTool = "read" | "find";

export const cursorTtlMs = 10 * 60 * 1000;

export interface XmlPosition {
  readonly t: CursorTool;
  readonly p: NodePath;
  readonly s: NodePath;
  readonly o: string;
  readonly x: number;
}

export type XmlCursor = Cursor<XmlPosition, 1>;

export function optionsHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex")
    .slice(0, 16);
}

function isPath(value: unknown): value is NodePath {
  return (
    Array.isArray(value) &&
    value.length <= limits.maxDomDepth &&
    value.every(
      (segment) =>
        typeof segment === "number" &&
        Number.isSafeInteger(segment) &&
        segment >= 1,
    )
  );
}

function isXmlCursor(candidate: unknown): candidate is XmlCursor {
  if (typeof candidate !== "object" || candidate === null) return false;
  const value = candidate as Record<string, unknown>;
  return (
    value["v"] === 1 &&
    typeof value["f"] === "string" &&
    /^[a-f0-9]{16,64}$/u.test(value["f"]) &&
    (value["t"] === "read" || value["t"] === "find") &&
    isPath(value["p"]) &&
    isPath(value["s"]) &&
    typeof value["o"] === "string" &&
    /^[a-f0-9]{16}$/u.test(value["o"]) &&
    typeof value["x"] === "number" &&
    Number.isSafeInteger(value["x"])
  );
}

export function encodePosition(
  stamp: Fingerprint,
  position: XmlPosition,
): string {
  return encodeCursor({ v: 1, f: stamp, ...position });
}

export function decodeCursor(raw: string, tool: CursorTool): XmlCursor {
  const parsed = decodeCursorPayload(raw);
  if (!isXmlCursor(parsed)) {
    throw new SkMcpXmlError(
      "invalid_cursor",
      "The cursor is not a token produced by a previous response.",
      "Call the tool again without a cursor.",
    );
  }
  if (parsed.t !== tool) {
    throw new SkMcpXmlError(
      "invalid_cursor",
      `That cursor belongs to a different tool.`,
      "Use the nextCursor this tool returned, or call it again without a cursor.",
    );
  }
  if (parsed.x <= Date.now()) {
    throw new SkMcpXmlError(
      "invalid_cursor",
      "The cursor expired.",
      "Call the tool again without a cursor.",
    );
  }
  return parsed;
}

export function assertFresh(cursor: XmlCursor, current: Fingerprint): void {
  if (!isFresh(cursor, current)) {
    throw new SkMcpXmlError(
      "stale_cursor",
      "The document changed while the previous page was being read.",
      "Call the tool again without a cursor.",
    );
  }
}

export function assertSameOptions(cursor: XmlCursor, hash: string): void {
  if (cursor.o !== hash) {
    throw new SkMcpXmlError(
      "invalid_argument",
      "The options differ from the ones the cursor was produced with.",
      "Drop cursor to start over with the new options.",
    );
  }
}
