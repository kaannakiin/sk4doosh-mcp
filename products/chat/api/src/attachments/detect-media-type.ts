import {
  MEDIA_TYPE_BY_EXTENSION,
  type SupportedMediaType,
} from "@chat/contracts/attachment/media-type";

export type DetectionFailure = "unsupported_extension" | "content_mismatch";

export type Detection =
  | { readonly ok: true; readonly mediaType: SupportedMediaType }
  | { readonly ok: false; readonly reason: DetectionFailure };

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Guard: only the three-byte prefix is checked. The fourth byte is the first
 * marker and varies by encoder — JFIF, EXIF, a bare quantisation table — so
 * pinning it rejects valid files. The `FF D9` trailer is not checked either:
 * progressive encodings and trailing padding make it unreliable.
 */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const GIF_PREFIX = [0x47, 0x49, 0x46, 0x38];

const GIF_SUFFIXES = [
  [0x37, 0x61],
  [0x39, 0x61],
];

const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];

const WEBP_FOURCC = [0x57, 0x45, 0x42, 0x50];

/**
 * Guard: bytes 4 to 7 are the RIFF chunk size and are deliberately skipped, and
 * one of these stream fourccs must follow at offset 12. `RIFF????WEBP` alone is
 * satisfied by any RIFF container renamed `.webp`; this is what proves there is
 * an image stream in it.
 */
const WEBP_STREAMS = [
  [0x56, 0x50, 0x38, 0x20],
  [0x56, 0x50, 0x38, 0x4c],
  [0x56, 0x50, 0x38, 0x58],
];

const NUL_SCAN_BYTES = 8 * 1024;

function extensionOf(filename: string): string {
  const match = /\.([^./\\]+)$/u.exec(filename);

  return match?.[1]?.toLowerCase() ?? "";
}

function startsWith(
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function startsWithZipSignature(bytes: Uint8Array): boolean {
  return startsWith(bytes, ZIP_SIGNATURE);
}

function isGif(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, GIF_PREFIX) &&
    GIF_SUFFIXES.some((suffix) => startsWith(bytes, suffix, 4))
  );
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, RIFF_SIGNATURE) &&
    startsWith(bytes, WEBP_FOURCC, 8) &&
    WEBP_STREAMS.some((stream) => startsWith(bytes, stream, 12))
  );
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
 * The byte proof each media type owes.
 *
 * Guard: a table rather than a chain, because nine types do not fit in a nested
 * ternary and because each entry naming its own proof is what the per-family
 * philosophy actually says. Magic bytes do not make an upload safe — a
 * signature-valid png can still be a decompression bomb — which is why no
 * decoder is ever added on this side: the per-file ceiling bounds the transfer,
 * the browser is the only decoder and it is sandboxed per origin, and the forced
 * content type means a polyglot cannot be reinterpreted as something scriptable.
 */
const PROOF_BY_MEDIA_TYPE: Readonly<
  Record<SupportedMediaType, (bytes: Uint8Array) => boolean>
> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    startsWithZipSignature,
  "application/vnd.ms-excel.sheet.macroEnabled.12": startsWithZipSignature,
  "text/csv": looksLikeText,
  "application/xml": looksLikeMarkup,
  "text/xml": looksLikeMarkup,
  "image/png": (bytes) => startsWith(bytes, PNG_SIGNATURE),
  "image/jpeg": (bytes) => startsWith(bytes, JPEG_SIGNATURE),
  "image/gif": isGif,
  "image/webp": isWebp,
};

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

  return PROOF_BY_MEDIA_TYPE[mediaType](bytes)
    ? { ok: true, mediaType }
    : { ok: false, reason: "content_mismatch" };
}
