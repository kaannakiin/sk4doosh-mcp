import type { ApiError } from "@chat/contracts/http/error";
import type { Locale } from "@chat/contracts/common/locale";

import { env } from "./env";

export class ApiRequestError extends Error {
  constructor(readonly payload: ApiError) {
    super(payload.message);
    this.name = "ApiRequestError";
  }
}

export function chatEndpoint(path: string): string {
  return `${env.VITE_CHAT_API_URL}${path}`;
}

export async function apiRequest(
  path: string,
  locale: Locale,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(chatEndpoint(path), {
    ...init,
    headers: { ...init.headers, "x-locale": locale },
  });

  if (response.status === 204) {
    return undefined;
  }

  const body: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(body as ApiError);
  }

  return body;
}
