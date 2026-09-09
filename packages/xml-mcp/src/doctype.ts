import { detectByteOrderMark } from "@sk-mcp/file-core";

export type UnsupportedPrologEncoding =
  | "ucs-4be"
  | "ucs-4le"
  | "ucs-4-2143"
  | "ucs-4-3412"
  | "ebcdic";

export interface PrologScan {
  readonly doctype: boolean;
  readonly limitReached: boolean;
  readonly unsupportedEncoding?: UnsupportedPrologEncoding;
}

const whitespace = new Set([" ", "\t", "\r", "\n"]);

function at(bytes: Buffer, index: number): number {
  return bytes[index] ?? -1;
}

function matches(bytes: Buffer, pattern: readonly number[]): boolean {
  if (bytes.length < pattern.length) return false;
  return pattern.every((byte, index) => at(bytes, index) === byte);
}

/**
 * XML 1.0 Appendix F. detectByteOrderMark names utf-32 correctly, but
 * decodeProlog has no branch for it and none for EBCDIC, so those prologs used
 * to fall through to the utf-8 reading, produce a first character that is not
 * "<", and report no DOCTYPE. Measured on the DOCTYPE corpus: utf-32le with a
 * mark, utf-32be and utf-32le without one, and an EBCDIC prolog were all missed
 * while the utf-8 control was caught. Refusing the family up front is what keeps
 * the prolog scanner, and not the doc.dtd backstop M11 measured as too late,
 * the primary gate.
 */
export function unsupportedPrologEncoding(
  bytes: Buffer,
): UnsupportedPrologEncoding | undefined {
  if (matches(bytes, [0x00, 0x00, 0xfe, 0xff])) return "ucs-4be";
  if (matches(bytes, [0xff, 0xfe, 0x00, 0x00])) return "ucs-4le";
  if (matches(bytes, [0x00, 0x00, 0xff, 0xfe])) return "ucs-4-2143";
  if (matches(bytes, [0xfe, 0xff, 0x00, 0x00])) return "ucs-4-3412";
  if (matches(bytes, [0x00, 0x00, 0x00, 0x3c])) return "ucs-4be";
  if (matches(bytes, [0x3c, 0x00, 0x00, 0x00])) return "ucs-4le";
  if (matches(bytes, [0x00, 0x00, 0x3c, 0x00])) return "ucs-4-2143";
  if (matches(bytes, [0x00, 0x3c, 0x00, 0x00])) return "ucs-4-3412";
  if (matches(bytes, [0x4c, 0x6f, 0xa7, 0x94])) return "ebcdic";
  return undefined;
}

function swapPairs(source: Buffer): Buffer {
  const swapped = Buffer.from(source);
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const first = swapped[index] ?? 0;
    swapped[index] = swapped[index + 1] ?? 0;
    swapped[index + 1] = first;
  }
  return swapped;
}

function decodeProlog(head: Buffer): string {
  const mark = detectByteOrderMark(head);
  if (mark?.encoding === "utf-8") {
    return head.subarray(mark.length).toString("utf8");
  }
  if (mark?.encoding === "utf-16le") {
    return head.subarray(mark.length).toString("utf16le");
  }
  if (mark?.encoding === "utf-16be") {
    return swapPairs(head.subarray(mark.length)).toString("utf16le");
  }
  if (head.length >= 4 && head[0] === 0x00 && head[2] === 0x00) {
    return swapPairs(head).toString("utf16le");
  }
  if (head.length >= 4 && head[1] === 0x00 && head[3] === 0x00) {
    return head.toString("utf16le");
  }
  return head.toString("utf8");
}

function scanWindow(bytes: Buffer, windowBytes: number): PrologScan {
  const truncated = bytes.length > windowBytes;
  const text = decodeProlog(
    bytes.subarray(0, Math.min(bytes.length, windowBytes)),
  );
  let index = 0;
  while (index < text.length) {
    const character = text[index] ?? "";
    if (whitespace.has(character)) {
      index += 1;
      continue;
    }
    if (character !== "<") {
      return { doctype: false, limitReached: false };
    }
    if (text.startsWith("<?", index)) {
      const end = text.indexOf("?>", index + 2);
      if (end < 0) {
        return { doctype: false, limitReached: truncated };
      }
      index = end + 2;
      continue;
    }
    if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      if (end < 0) {
        return { doctype: false, limitReached: truncated };
      }
      index = end + 3;
      continue;
    }
    if (text.startsWith("<!DOCTYPE", index)) {
      return { doctype: true, limitReached: false };
    }
    return { doctype: false, limitReached: false };
  }
  return { doctype: false, limitReached: truncated };
}

export function scanProlog(bytes: Buffer, windowBytes: number): PrologScan {
  const unsupported = unsupportedPrologEncoding(bytes);
  if (unsupported !== undefined) {
    return {
      doctype: false,
      limitReached: false,
      unsupportedEncoding: unsupported,
    };
  }
  const first = scanWindow(bytes, windowBytes);
  if (!first.limitReached) {
    return first;
  }
  return scanWindow(bytes, bytes.length);
}
