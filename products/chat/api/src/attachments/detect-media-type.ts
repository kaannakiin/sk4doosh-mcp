import {
  MEDIA_TYPE_BY_EXTENSION,
  type SupportedMediaType,
} from "@chat/contracts/attachment/media-type";

export type DetectionFailure = "unsupported_extension" | "content_mismatch";

export type Detection =
  | { readonly ok: true; readonly mediaType: SupportedMediaType }
  | { readonly ok: false; readonly reason: DetectionFailure };

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

const NUL_SCAN_BYTES = 8 * 1024;

function extensionOf(filename: string): string {
  const match = /\.([^./\\]+)$/u.exec(filename);

  return match?.[1]?.toLowerCase() ?? "";
}

function startsWithZipSignature(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function skipByteOrderMark(bytes: Uint8Array): number {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
}

function looksLikeMarkup(bytes: Uint8Array): boolean {
  for (let index = skipByteOrderMark(bytes); index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      return false;
    }
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      continue;
    }

    return byte === 0x3c;
  }

  return false;
}

function looksLikeText(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, NUL_SCAN_BYTES);
  for (let index = 0; index < end; index += 1) {
    if (bytes[index] === 0x00) {
      return false;
    }
  }

  return true;
}

/**
 * Resolves the media type of an upload from its extension and then proves it
 * against the bytes.
 *
 * Guard: the extension decides, not the browser's `Content-Type`. A client is
 * free to declare anything, and the readers dispatch on extension anyway. The
 * content check is deliberately per-family rather than a magic-number lookup:
 * xlsx and xlsm are ZIP containers and do have a signature, but CSV has no
 * magic number at all and XML's is a `<`, so a generic signature validator
 * would reject every CSV. Refusing the file outright is the point — a mistyped
 * upload must not reach the reader as a parse error the model then narrates.
 */
export function detectMediaType(
  filename: string,
  bytes: Uint8Array,
): Detection {
  const mediaType = MEDIA_TYPE_BY_EXTENSION[extensionOf(filename)];
  if (mediaType === undefined) {
    return { ok: false, reason: "unsupported_extension" };
  }

  const proven =
    mediaType === "text/csv"
      ? looksLikeText(bytes)
      : mediaType === "application/xml" || mediaType === "text/xml"
        ? looksLikeMarkup(bytes)
        : startsWithZipSignature(bytes);

  return proven
    ? { ok: true, mediaType }
    : { ok: false, reason: "content_mismatch" };
}
