import type { Locale } from "@chat/contracts/common/locale";
import { apiErrorSchema, type ApiError } from "@chat/contracts/http/error";
import type { ContractSchema } from "@chat/queries/client";

import { env } from "./env";

const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiRequestError extends Error {
  constructor(readonly payload: ApiError) {
    super(payload.message);
    this.name = "ApiRequestError";
  }
}

export function chatEndpoint(path: string): string {
  return `${env.VITE_CHAT_API_URL}${path}`;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  locale: Locale;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Calls the chat api and parses the answer against a contract schema.
 *
 * @param path api path, already encoded
 * @param schema the contract schema the success body must satisfy
 * @returns the parsed body
 * @throws ApiRequestError when the api answers with an error envelope
 */
export async function request<TOutput>(
  path: string,
  schema: ContractSchema<TOutput>,
  options: RequestOptions,
): Promise<TOutput> {
  return schema.parse(await send(path, options));
}

/**
 * Calls an api route that answers with no body.
 *
 * @throws ApiRequestError when the api answers with an error envelope
 */
export async function requestNoContent(
  path: string,
  options: RequestOptions,
): Promise<void> {
  await send(path, options);
}

async function send(path: string, options: RequestOptions): Promise<unknown> {
  const response = await fetch(chatEndpoint(path), {
    method: options.method ?? "GET",
    headers: headersFor(options),
    body: bodyFor(options.body),
    signal: abortFor(options),
  });

  if (
    response.status === 204 ||
    response.headers.get("content-length") === "0"
  ) {
    if (response.ok) {
      return undefined;
    }
    throw new ApiRequestError({
      code: codeFor(response.status),
      message: response.statusText,
    });
  }

  const raw: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    return raw;
  }

  /**
   * Guard: the error body is parsed, not asserted. A proxy or a crashed process
   * answers with html or with nothing at all, and casting that to `ApiError`
   * produces an error object whose `message` is `undefined` — which surfaces to
   * the user as a blank toast instead of something actionable.
   */
  const envelope = apiErrorSchema.safeParse(raw);

  throw new ApiRequestError(
    envelope.success
      ? envelope.data
      : { code: codeFor(response.status), message: response.statusText },
  );
}

/**
 * Guard: `Content-Type` is never set for `FormData`. The browser has to write it
 * itself so it can append the multipart boundary, and setting it by hand
 * produces a body the server cannot split — which is why the upload call used to
 * bypass this helper entirely.
 */
function headersFor(options: RequestOptions): HeadersInit {
  const headers: Record<string, string> = { "x-locale": options.locale };
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers["content-type"] = "application/json";
  }

  return headers;
}

function bodyFor(body: unknown): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  return body instanceof FormData ? body : JSON.stringify(body);
}

function abortFor(options: RequestOptions): AbortSignal {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  return options.signal === undefined
    ? timeout
    : AbortSignal.any([timeout, options.signal]);
}

function codeFor(status: number): string {
  return status >= 500 ? "internal_error" : "bad_request";
}
