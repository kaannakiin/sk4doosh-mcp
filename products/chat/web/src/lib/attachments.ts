import type { Attachment } from "@chat/contracts/attachment/attachment";
import {
  attachmentListResponseSchema,
  uploadResponseSchema,
} from "@chat/contracts/attachment/upload";
import type { Locale } from "@chat/contracts/common/locale";

import { apiRequest, chatEndpoint, ApiRequestError } from "./api";

function query(sessionId: string): string {
  return `?sessionId=${encodeURIComponent(sessionId)}`;
}

export async function uploadAttachment(
  sessionId: string,
  file: File,
  locale: Locale,
): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file, file.name);

  const response = await fetch(chatEndpoint(`/chat/files${query(sessionId)}`), {
    method: "POST",
    body: form,
    headers: { "x-locale": locale },
  });

  const body: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(
      body as ConstructorParameters<typeof ApiRequestError>[0],
    );
  }

  return uploadResponseSchema.parse(body).attachment;
}

export async function listAttachments(
  sessionId: string,
  locale: Locale,
): Promise<Attachment[]> {
  const body = await apiRequest(`/chat/files${query(sessionId)}`, locale);

  return attachmentListResponseSchema.parse(body).attachments;
}

export async function removeAttachment(
  sessionId: string,
  attachmentId: string,
  locale: Locale,
): Promise<Attachment[]> {
  const body = await apiRequest(
    `/chat/files/${encodeURIComponent(attachmentId)}${query(sessionId)}`,
    locale,
    { method: "DELETE" },
  );

  return attachmentListResponseSchema.parse(body).attachments;
}
