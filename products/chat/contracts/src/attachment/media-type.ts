import { z } from "zod";

export const SUPPORTED_MEDIA_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "text/csv",
  "application/xml",
  "text/xml",
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
};

export const MEDIA_TYPE_BY_EXTENSION: Readonly<
  Record<string, SupportedMediaType>
> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  csv: "text/csv",
  xml: "application/xml",
};

export const SUPPORTED_EXTENSIONS = Object.keys(
  MEDIA_TYPE_BY_EXTENSION,
) as readonly string[];

export const readerFamilySchema = z.enum(["workbook", "document"]);

export type ReaderFamily = z.infer<typeof readerFamilySchema>;

/**
 * Which MCP server can read a media type. `workbook` is served by the Excel
 * reader (xlsx, xlsm and csv), `document` by the XML reader.
 */
export const READER_FAMILY_BY_MEDIA_TYPE: Readonly<
  Record<SupportedMediaType, ReaderFamily>
> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "workbook",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "workbook",
  "text/csv": "workbook",
  "application/xml": "document",
  "text/xml": "document",
};

export function isSupportedMediaType(
  value: unknown,
): value is SupportedMediaType {
  return mediaTypeSchema.safeParse(value).success;
}
