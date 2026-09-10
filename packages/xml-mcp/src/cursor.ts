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

export type CursorTool = "read" | "find" | "xpath" | "records";

export const cursorTtlMs = 10 * 60 * 1000;

interface Bound {
  readonly o: string;
  readonly x: number;
}

interface Walked extends Bound {
  readonly p: NodePath;
  readonly s: NodePath;
}

interface Ordinal extends Bound {
  readonly i: number;
}

/**
 * `b` is advisory. Every page re-verifies it against the record it claims to
 * start and falls back to scanning from zero when it does not hold, so a forged
 * `b` can only cost a pass, never yield a row the hint-free path would not.
 * chunked-cursor.spec.ts fuzzes it.
 */
interface Scanned extends Ordinal {
  readonly b?: number;
}

export type XmlPosition =
  | (Walked & { readonly t: "read" })
  | (Walked & { readonly t: "find" })
  | (Ordinal & { readonly t: "xpath" })
  | (Scanned & { readonly t: "records" });

export type XmlPositionOf<K extends CursorTool> = Extract<
  XmlPosition,
  { readonly t: K }
>;

export type XmlCursorOf<K extends CursorTool> = Cursor<XmlPositionOf<K>, 1>;

export type XmlCursor = XmlCursorOf<CursorTool>;

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

function isOrdinal(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isWalked(value: Record<string, unknown>): boolean {
  return isPath(value["p"]) && isPath(value["s"]);
}

const shapes: {
  readonly [K in CursorTool]: (value: Record<string, unknown>) => boolean;
} = {
  read: isWalked,
  find: isWalked,
  xpath: (value) => isOrdinal(value["i"]),
  records: (value) =>
    isOrdinal(value["i"]) &&
    (value["b"] === undefined ||
      (typeof value["b"] === "number" &&
        Number.isSafeInteger(value["b"]) &&
        value["b"] >= 0)),
};

function isXmlCursor<K extends CursorTool>(
  candidate: unknown,
  tool: K,
): candidate is XmlCursorOf<K> {
  if (typeof candidate !== "object" || candidate === null) return false;
  const value = candidate as Record<string, unknown>;
  return (
    value["v"] === 1 &&
    typeof value["f"] === "string" &&
    /^[a-f0-9]{16,64}$/u.test(value["f"]) &&
    value["t"] === tool &&
    typeof value["o"] === "string" &&
    /^[a-f0-9]{16}$/u.test(value["o"]) &&
    typeof value["x"] === "number" &&
    Number.isSafeInteger(value["x"]) &&
    shapes[tool](value)
  );
}

function isKnownTool(value: unknown): value is CursorTool {
  return (
    value === "read" ||
    value === "find" ||
    value === "xpath" ||
    value === "records"
  );
}

export function encodePosition(
  stamp: Fingerprint,
  position: XmlPosition,
): string {
  return encodeCursor({ v: 1, f: stamp, ...position });
}

export function decodeCursor<K extends CursorTool>(
  raw: string,
  tool: K,
): XmlCursorOf<K> {
  const parsed = decodeCursorPayload(raw);
  if (isXmlCursor(parsed, tool)) {
    if (parsed.x <= Date.now()) {
      throw new SkMcpXmlError(
        "invalid_cursor",
        "The cursor expired.",
        "Call the tool again without a cursor.",
      );
    }
    return parsed;
  }
  const claimed =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)["t"]
      : undefined;
  if (isKnownTool(claimed) && claimed !== tool) {
    throw new SkMcpXmlError(
      "invalid_cursor",
      "That cursor belongs to a different tool.",
      "Use the nextCursor this tool returned, or call it again without a cursor.",
    );
  }
  throw new SkMcpXmlError(
    "invalid_cursor",
    "The cursor is not a token produced by a previous response.",
    "Call the tool again without a cursor.",
  );
}

export function assertFresh(
  cursor: { readonly f: Fingerprint },
  current: Fingerprint,
): void {
  if (!isFresh({ v: 1, f: cursor.f }, current)) {
    throw new SkMcpXmlError(
      "stale_cursor",
      "The document changed while the previous page was being read.",
      "Call the tool again without a cursor.",
    );
  }
}

export function assertSameOptions(
  cursor: { readonly o: string },
  hash: string,
): void {
  if (cursor.o !== hash) {
    throw new SkMcpXmlError(
      "invalid_argument",
      "The options differ from the ones the cursor was produced with.",
      "Drop cursor to start over with the new options.",
    );
  }
}
