import type { ApiError } from "@chat/contracts/http/error";
import type { Locale } from "@chat/contracts/common/locale";
import {
  sendMessageResponseSchema,
  type SendMessageResponse,
} from "@chat/contracts/chat/send-message";

import { env } from "./env";

export class ApiRequestError extends Error {
  constructor(readonly payload: ApiError) {
    super(payload.message);
    this.name = "ApiRequestError";
  }
}

export async function sendMessage(
  content: string,
  locale: Locale,
): Promise<SendMessageResponse> {
  const response = await fetch(`${env.VITE_CHAT_API_URL}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-locale": locale },
    body: JSON.stringify({ content }),
  });

  const body: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(body as ApiError);
  }

  return sendMessageResponseSchema.parse(body);
}
