import {
  sendMessageResponseSchema,
  type ApiError,
  type Locale,
  type SendMessageResponse,
} from "@chat/contracts";

const baseUrl = import.meta.env["VITE_CHAT_API_URL"] ?? "http://127.0.0.1:5191";

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
  const response = await fetch(`${baseUrl}/chat`, {
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
