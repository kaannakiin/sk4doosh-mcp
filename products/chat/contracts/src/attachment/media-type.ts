import { z } from "zod";

export const SUPPORTED_MEDIA_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "text/csv",
  "application/xml",
  "text/xml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const mediaTypeSchema = z.enum(SUPPORTED_MEDIA_TYPES);

export type SupportedMediaType = z.infer<typeof mediaTypeSchema>;

export const EXTENSION_BY_MEDIA_TYPE: Readonly<
  Record<SupportedMediaType, string>
> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "xlsm",
  "text/csv": "csv",
  "application/xml": "xml",
  "text/xml": "xml",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Guard: `svg` is absent and must stay absent. An SVG opened as a top-level
 * document executes `<script>`, `onload=` and `javascript:` in the storage
 * origin, and a presigned url is exactly such a top-level navigation. It also
 * collides with the xml family — an SVG renamed `.xml` already passes the markup
 * proof and is routed to the XML reader, which is only safe because xml is never
 * served inline. There is no byte signature that proves an SVG carries no
 * script, so admitting it would mean a sanitizer and the bypass treadmill that
 * comes with one.
 */
export const MEDIA_TYPE_BY_EXTENSION: Readonly<
  Record<string, SupportedMediaType>
> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  csv: "text/csv",
  xml: "application/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export const SUPPORTED_EXTENSIONS = Object.keys(
  MEDIA_TYPE_BY_EXTENSION,
) as readonly string[];

export const readerFamilySchema = z.enum(["workbook", "document"]);

export type ReaderFamily = z.infer<typeof readerFamilySchema>;

/**
 * Which MCP server can read a media type, or `null` when none can.
 *
 * Guard: images map to `null` rather than to an `"image"` family. `ReaderFamily`
 * names a reader process, and adding a third value that has none is silently
 * wrong in two places at once: the reader lookup is a two-branch ternary, so the
 * new value falls through to the XML command and spawns that process for a
 * session holding only a picture; and the schema table has no entry for it, so
 * the client is asked for its tools with no schemas and falls back to dynamic
 * discovery, exposing the whole reader surface the catalog deliberately
 * withholds. Nullability makes the same mistake a compile error instead, because
 * indexing the schema table with `ReaderFamily | null` does not type-check until
 * the null is narrowed away.
 */
export const READER_FAMILY_BY_MEDIA_TYPE: Readonly<
  Record<SupportedMediaType, ReaderFamily | null>
> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "workbook",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "workbook",
  "text/csv": "workbook",
  "application/xml": "document",
  "text/xml": "document",
  "image/png": null,
  "image/jpeg": null,
  "image/webp": null,
  "image/gif": null,
};

/**
 * Media types a browser may render inline from a presigned url.
 *
 * Guard: this is the allow-list the presigner consults, and it is read from the
 * stored media type, never from a request parameter. Everything outside it is
 * served as `attachment` with `application/octet-stream`, so markup-shaped
 * content can never enter a rendering context in the storage origin.
 */
export const INLINE_MEDIA_TYPES: ReadonlySet<SupportedMediaType> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function isInlineMediaType(value: SupportedMediaType): boolean {
  return INLINE_MEDIA_TYPES.has(value);
}

export function isSupportedMediaType(
  value: unknown,
): value is SupportedMediaType {
  return mediaTypeSchema.safeParse(value).success;
}
