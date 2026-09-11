import type { Attachment } from "@chat/contracts/attachment/attachment";
import type { SupportedMediaType } from "@chat/contracts/attachment/media-type";

const KIND_BY_MEDIA_TYPE: Readonly<Record<SupportedMediaType, string>> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "xlsx workbook",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "xlsm workbook",
  "text/csv": "csv table",
  "application/xml": "xml document",
  "text/xml": "xml document",
};

function kilobytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024));
}

/**
 * Renders the session's files as the `filePath` values the reader tools accept.
 * This is why neither reader's listing tool is exposed: the store already knows
 * exactly what was uploaded, so a listing call would be a second, weaker source
 * of the same truth that the model could contradict.
 */
export function attachmentManifest(attachments: readonly Attachment[]): string {
  return attachments
    .map(
      (attachment) =>
        `- ${attachment.sandboxPath} (${attachment.filename}, ${KIND_BY_MEDIA_TYPE[attachment.mediaType]}, ${String(kilobytes(attachment.bytes))} KB)`,
    )
    .join("\n");
}
