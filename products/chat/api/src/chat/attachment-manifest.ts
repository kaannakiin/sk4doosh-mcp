import type { Attachment } from "@chat/contracts/attachment/attachment";
import type { SupportedMediaType } from "@chat/contracts/attachment/media-type";

const KIND_BY_MEDIA_TYPE: Readonly<Record<SupportedMediaType, string>> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "xlsx workbook",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "xlsm workbook",
  "text/csv": "csv table",
  "application/xml": "xml document",
  "text/xml": "xml document",
  "image/png": "png image",
  "image/jpeg": "jpeg image",
  "image/webp": "webp image",
  "image/gif": "gif image",
};

const MANIFEST_MAX_LINES = 32;

export interface Manifest {
  readonly readable: readonly string[];
  readonly images: readonly string[];
}

function kilobytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024));
}

/**
 * Splits the session's files into what a tool can open and what it cannot.
 *
 * Readable files are rendered as the `filePath` values the reader tools accept —
 * which is why neither reader's listing tool is exposed: the store already knows
 * exactly what was uploaded, so a listing call would be a second, weaker source
 * of the same truth the model could contradict.
 *
 * Guard: an image line carries the display name and nothing path-shaped. No tool
 * can open an image, and a model that never sees a path cannot put one in a
 * `filePath` argument — which is the actual guarantee here; the prose in the
 * system prompt is only reinforcement. Without it the model spends one of its
 * eight steps calling a reader on a png and narrating the error it gets back.
 */
export function attachmentManifest(
  attachments: readonly Attachment[],
): Manifest {
  const readable: string[] = [];
  const images: string[] = [];

  for (const attachment of attachments) {
    const kind = KIND_BY_MEDIA_TYPE[attachment.mediaType];
    const size = `${String(kilobytes(attachment.bytes))} KB`;
    if (attachment.sandboxPath === null) {
      images.push(`- ${attachment.filename} (${kind}, ${size})`);
    } else {
      readable.push(
        `- ${attachment.sandboxPath} (${attachment.filename}, ${kind}, ${size})`,
      );
    }
  }

  return { readable: cap(readable), images: cap(images) };
}

/**
 * Guard: the rendered list is bounded independently of the upload ceiling, so
 * raising `CHAT_UPLOAD_MAX_FILES` cannot quietly grow the system prompt into the
 * context window the answer needs.
 */
function cap(lines: string[]): string[] {
  if (lines.length <= MANIFEST_MAX_LINES) {
    return lines;
  }

  return [
    ...lines.slice(0, MANIFEST_MAX_LINES),
    `- (+${String(lines.length - MANIFEST_MAX_LINES)} more)`,
  ];
}
