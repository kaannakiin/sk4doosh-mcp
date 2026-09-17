import { asciiLower } from "./text.js";

const utf8Bom = [0xef, 0xbb, 0xbf] as const;
const utf16LeBom = [0xff, 0xfe] as const;
const utf16BeBom = [0xfe, 0xff] as const;

export type PartEncoding = "utf-8" | "utf-16le" | "utf-16be";

export interface DecodedPart {
  readonly text: string;
  readonly encoding: PartEncoding;
}

export function startsWith(
  bytes: Uint8Array,
  prefix: readonly number[],
): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * Guard: an OPC part may legally be UTF-16, so the byte order mark decides the
 * decoding before anything reads the prolog. Assuming UTF-8 turns a UTF-16 part
 * into mojibake that then fails as "not well-formed XML", which names the wrong
 * defect and sends the caller to re-save a file that was never malformed.
 */
export function decodePart(bytes: Uint8Array): DecodedPart {
  if (startsWith(bytes, utf16LeBom)) {
    return {
      text: new TextDecoder("utf-16le").decode(bytes.subarray(2)),
      encoding: "utf-16le",
    };
  }
  if (startsWith(bytes, utf16BeBom)) {
    return {
      text: new TextDecoder("utf-16be").decode(bytes.subarray(2)),
      encoding: "utf-16be",
    };
  }
  const body = startsWith(bytes, utf8Bom) ? bytes.subarray(3) : bytes;
  return { text: new TextDecoder("utf-8").decode(body), encoding: "utf-8" };
}

const declaredEncoding = /^<\?xml\b[^>]*?\bencoding\s*=\s*["']([^"']+)["']/;

/**
 * Reads the encoding named by the XML declaration, if any. The caller compares
 * it with the byte order mark's verdict; a part that declares a code page this
 * reader does not decode is refused rather than silently read as UTF-8.
 *
 * @returns the declared name ASCII-folded, or undefined when the part
 * carries no declaration or no encoding attribute.
 */
export function declaredEncodingOf(text: string): string | undefined {
  const matched = declaredEncoding.exec(text.slice(0, 256));
  const name = matched?.[1];
  return name === undefined ? undefined : asciiLower(name);
}
