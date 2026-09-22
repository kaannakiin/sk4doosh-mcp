import { createHash } from "node:crypto";
import {
  decodeCursorPayload,
  encodeCursor,
  isFresh,
  type Cursor,
  type Fingerprint,
} from "@sk-mcp/file-core";
import { SkMcpPdfError } from "../platform/errors.js";

export type CursorTool = "read" | "find";

export const cursorTtlMs = 10 * 60 * 1000;

interface Bound {
  readonly o: string;
  readonly x: number;
}

interface ReadPosition extends Bound {
  readonly t: "read";
  readonly p: number;
}

interface FindPosition extends Bound {
  readonly t: "find";
  readonly p: number;
  readonly i: number;
}

export type PdfPosition = ReadPosition | FindPosition;

export type PdfPositionOf<K extends CursorTool> = Extract<
  PdfPosition,
  { readonly t: K }
>;

export type PdfCursorOf<K extends CursorTool> = Cursor<PdfPositionOf<K>, 1>;

export function optionsHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex")
    .slice(0, 16);
}

function isOrdinal(value: unknown, minimum: number): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

const shapes: {
  readonly [K in CursorTool]: (value: Record<string, unknown>) => boolean;
} = {
  read: (value) => isOrdinal(value["p"], 1),
  find: (value) => isOrdinal(value["p"], 1) && isOrdinal(value["i"], 0),
};

function isPdfCursor<K extends CursorTool>(
  candidate: unknown,
  tool: K,
): candidate is PdfCursorOf<K> {
  if (typeof candidate !== "object" || candidate === null) return false;
  const value = candidate as Record<string, unknown>;
  return (
    value["v"] === 1 &&
    typeof value["f"] === "string" &&
    /^[a-f0-9]{16,64}$/u.test(value["f"]) &&
    value["t"] === tool &&
    typeof value["o"] === "string" &&
    /^[a-f0-9]{16}$/u.test(value["o"]) &&
    isOrdinal(value["x"], 0) &&
    shapes[tool](value)
  );
}

function isKnownTool(value: unknown): value is CursorTool {
  return value === "read" || value === "find";
}

export function encodePosition(
  stamp: Fingerprint,
  position: PdfPosition,
): string {
  return encodeCursor({ v: 1, f: stamp, ...position });
}

export function decodeCursor<K extends CursorTool>(
  raw: string,
  tool: K,
): PdfCursorOf<K> {
  const parsed = decodeCursorPayload(raw);
  if (isPdfCursor(parsed, tool)) {
    if (parsed.x <= Date.now()) {
      throw new SkMcpPdfError(
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
    throw new SkMcpPdfError(
      "invalid_cursor",
      "That cursor belongs to a different tool.",
      "Use the nextCursor this tool returned, or call it again without a cursor.",
    );
  }
  throw new SkMcpPdfError(
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
    throw new SkMcpPdfError(
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
    throw new SkMcpPdfError(
      "invalid_argument",
      "The options differ from the ones the cursor was produced with.",
      "Drop cursor to start over with the new options.",
    );
  }
}
