import type { Attachment } from "@chat/contracts/attachment/attachment";
import { isSupportedMediaType } from "@chat/contracts/attachment/media-type";
import {
  isDataUIPart,
  type UIDataTypes,
  type UIMessage,
  type UIMessagePart,
  type UITools,
} from "ai";

/**
 * Guard: a data part, not a `file` part. `convertToModelMessages` turns a file
 * part into model content and reads `new URL(part.url)`, which would put an
 * xlsx the provider cannot accept into the prompt and throw on a relative url;
 * a data part reaches `convertDataPart`, and the api passes none, so this is
 * dropped before the model sees the turn. The api stores `parts` verbatim and
 * `validateUIMessages` admits any `data-` part, so it persists with no schema
 * change and no server code that knows about it.
 */
const PART_TYPE = "data-attached-files";

/**
 * What a message recorded about one file, frozen at the moment it was sent.
 *
 * Guard: a snapshot rather than an id to look up later. Attachments are scoped
 * to the session and can be removed while the conversation stays, so a turn
 * rendered from the live list would lose its chips retroactively — the message
 * has to keep saying what was asked about.
 */
export type AttachedFile = Pick<
  Attachment,
  "id" | "filename" | "mediaType" | "bytes"
>;

export function attachedFilesPart(
  files: readonly AttachedFile[],
): UIMessagePart<UIDataTypes, UITools> {
  return {
    type: PART_TYPE,
    data: files.map(({ id, filename, mediaType, bytes }) => ({
      id,
      filename,
      mediaType,
      bytes,
    })),
  };
}

export function attachedFiles(message: UIMessage): readonly AttachedFile[] {
  const found: AttachedFile[] = [];
  for (const part of message.parts) {
    if (!isDataUIPart(part) || part.type !== PART_TYPE) {
      continue;
    }
    if (!Array.isArray(part.data)) {
      continue;
    }
    for (const entry of part.data as readonly unknown[]) {
      const file = readFile(entry);
      if (file !== undefined) {
        found.push(file);
      }
    }
  }

  return found;
}

/**
 * The session's files that no turn has carried yet — what the composer is still
 * holding.
 */
export function unsentAttachments(
  messages: readonly UIMessage[],
  attachments: readonly Attachment[],
): readonly Attachment[] {
  if (attachments.length === 0) {
    return attachments;
  }

  const sent = new Set<string>();
  for (const message of messages) {
    for (const file of attachedFiles(message)) {
      sent.add(file.id);
    }
  }

  return sent.size === 0
    ? attachments
    : attachments.filter((attachment) => !sent.has(attachment.id));
}

/**
 * Guard: every field is checked even though this package wrote the part. It
 * comes back through a jsonb column that the api validates with `data: unknown`,
 * so the only thing standing between a hand-edited row and a render is this.
 */
function readFile(value: unknown): AttachedFile | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  if (!("id" in value) || typeof value.id !== "string") {
    return undefined;
  }
  if (!("filename" in value) || typeof value.filename !== "string") {
    return undefined;
  }
  if (!("bytes" in value) || typeof value.bytes !== "number") {
    return undefined;
  }
  if (!("mediaType" in value) || !isSupportedMediaType(value.mediaType)) {
    return undefined;
  }

  return {
    id: value.id,
    filename: value.filename,
    mediaType: value.mediaType,
    bytes: value.bytes,
  };
}
