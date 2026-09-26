import { createHash } from "node:crypto";
import {
  decodeCursorPayload,
  encodeCursor,
  isFresh,
  type Cursor,
  type Fingerprint,
} from "@liaiso/file-core";
import { LiaisoPdfError } from "../platform/errors.js";
import { limits } from "../platform/limits.js";

export type CursorTool = "read" | "find";

export const cursorTtlMs = 10 * 60 * 1000;

interface Bound {
  readonly o: string;
  readonly x: number;
}

/**
 * Guard: an offset is only meaningful against the text it was measured in, so
 * it never travels without that text's digest. Either both are present or
 * neither is.
 */
export type PageAnchor =
  | { readonly c: number; readonly h: string }
  | { readonly c?: never; readonly h?: never };

type ReadPosition = Bound & {
  readonly t: "read";
  readonly p: number;
  /** The part of an explicit selection not yet delivered, starting at `p`. */
  readonly s?: readonly number[];
} & PageAnchor;

type FindPosition = Bound & {
  readonly t: "find";
  readonly p: number;
  readonly i: number;
  /** Unsearchable pages the walk has already passed. */
  readonly u: number;
  readonly h?: string;
};

export type PdfPosition = ReadPosition | FindPosition;

export type PdfPositionOf<K extends CursorTool> = Extract<
  PdfPosition,
  { readonly t: K }
>;

export type PdfCursorOf<K extends CursorTool> = Cursor<PdfPositionOf<K>, 1>;

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function optionsHash(value: unknown): string {
  return digest(JSON.stringify(value) ?? "null");
}

export function pageDigest(markdown: string): string {
  return digest(markdown);
}

function isOrdinal(value: unknown, minimum: number): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

const digestPattern = /^[a-f0-9]{16}$/u;

function isDigest(value: unknown): boolean {
  return typeof value === "string" && digestPattern.test(value);
}

function isAnchor(value: Record<string, unknown>): boolean {
  if (value["c"] === undefined && value["h"] === undefined) return true;
  return isOrdinal(value["c"], 1) && isDigest(value["h"]);
}

function isSelection(value: unknown, first: unknown): boolean {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= limits.maxReadPages &&
    value.every((page) => isOrdinal(page, 1)) &&
    value[0] === first
  );
}

const shapes: {
  readonly [K in CursorTool]: (value: Record<string, unknown>) => boolean;
} = {
  read: (value) =>
    isOrdinal(value["p"], 1) &&
    isAnchor(value) &&
    isSelection(value["s"], value["p"]),
  find: (value) =>
    isOrdinal(value["p"], 1) &&
    isOrdinal(value["i"], 0) &&
    isOrdinal(value["u"], 0) &&
    (value["h"] === undefined || isDigest(value["h"])),
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
    digestPattern.test(value["o"]) &&
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
      throw new LiaisoPdfError(
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
    throw new LiaisoPdfError(
      "invalid_cursor",
      "That cursor belongs to a different tool.",
      "Use the nextCursor this tool returned, or call it again without a cursor.",
    );
  }
  throw new LiaisoPdfError(
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
    throw new LiaisoPdfError(
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
    throw new LiaisoPdfError(
      "invalid_argument",
      "The options differ from the ones the cursor was produced with.",
      "Drop cursor to start over with the new options.",
    );
  }
}

/**
 * Guard: an OCR page's text is produced again once its transcription leaves the
 * cache, and a provider need not answer the same way twice. An offset or match
 * ordinal measured in the old text would then skip or repeat content with no
 * sign that it had, so a resume inside a page whose text changed is refused.
 */
export function assertSameText(
  expected: string | undefined,
  page: number,
  markdown: string,
): void {
  if (expected !== undefined && expected !== pageDigest(markdown)) {
    throw new LiaisoPdfError(
      "stale_cursor",
      `The text of page ${String(page)} changed since the cursor was produced; it was transcribed again.`,
      "Call the tool again without a cursor.",
    );
  }
}
