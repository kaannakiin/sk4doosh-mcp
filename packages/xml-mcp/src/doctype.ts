import { detectByteOrderMark } from "@sk-mcp/file-core";

export interface PrologScan {
  readonly doctype: boolean;
  readonly limitReached: boolean;
}

const whitespace = new Set([" ", "\t", "\r", "\n"]);

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
  const first = scanWindow(bytes, windowBytes);
  if (!first.limitReached) {
    return first;
  }
  return scanWindow(bytes, bytes.length);
}
