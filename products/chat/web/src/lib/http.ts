import type { Locale } from "@chat/contracts/common/locale";
import { AUTH_PATHS } from "@chat/queries/auth/path";
import type { ContractSchema } from "@chat/queries/client";

import { unwrap } from "./api-response";
import { refreshSession, sessionEpoch } from "./auth-refresh";
import { env } from "./env";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Guard: every call opts in, including the same-origin proxy shape where it is a
 * no-op. `VITE_CHAT_API_URL` also accepts an absolute url for an api on its own
 * host, and there the default `same-origin` mode sends no session cookie and
 * keeps none the api returns — the app then runs as a permanent anonymous with
 * no error to read.
 */
export const CREDENTIALS: RequestCredentials = "include";

export { ApiRequestError } from "./api-response";

export function chatEndpoint(path: string): string {
  return `${env.VITE_CHAT_API_URL}${path}`;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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

/**
 * Guard: the 401 body is cancelled only once the retry is certain. A refusal to
 * rotate ends with that first response being unwrapped, and a cancelled stream
 * unwraps to `bad_request` instead of the `unauthorized`/`session_expired` the
 * api sent — which is exactly the pair `currentUserOptions` reads to tell an
 * anonymous reader from a failure.
 */
async function send(path: string, options: RequestOptions): Promise<unknown> {
  const since = await sessionEpoch();
  const response = await dispatch(path, options);
  if (response.status !== 401 || !isRefreshable(path)) {
    return unwrap(response);
  }
  if (!(await refreshSession(options.locale, since))) {
    return unwrap(response);
  }
  await response.body?.cancel();

  return unwrap(await dispatch(path, options));
}

function dispatch(path: string, options: RequestOptions): Promise<Response> {
  return fetch(chatEndpoint(path), {
    method: options.method ?? "GET",
    headers: headersFor(options),
    body: bodyFor(options.body),
    credentials: CREDENTIALS,
    signal: abortFor(options),
  });
}

/**
 * Guard: the retry is keyed on the http status, never on the error code. A
 * failed `AuthOriginGuard` check answers 403 and the filter rewrites it to
 * `unauthorized` — the same code a lapsed cookie produces — so refreshing on the
 * code would put a csrf rejection into a loop that never terminates.
 *
 * Guard: credential routes are excluded. `/auth/login/password` answers 401 with
 * `invalid_credentials` for a wrong password, and rotating a perfectly good
 * session in response to a typo is the opposite of what the reader asked for.
 */
function isRefreshable(path: string): boolean {
  return path === AUTH_PATHS.me || !path.startsWith("/auth/");
}

/**
 * Wraps `fetch` so the AI SDK's streaming turn survives a lapsed access cookie.
 *
 * Guard: the chat stream does not go through `request`, it is handed straight to
 * the transport — which makes the longest-lived and most 401-prone call in the
 * app the one call the retry above would otherwise miss. The SDK's body is a
 * string, so replaying it is safe.
 *
 * Guard: the credentials mode is forced rather than read from `init`. The SDK
 * copies it from `ChatClient.credentials`, so trusting the caller would make the
 * stream the one request that silently drops the session cookie if that field is
 * ever unset.
 */
export const authFetch: typeof fetch = async (input, init) => {
  const credentialed = { ...init, credentials: CREDENTIALS };
  const since = await sessionEpoch();
  const response = await fetch(input, credentialed);
  if (response.status !== 401) {
    return response;
  }
  const locale = localeOf(init);
  if (locale === undefined || !(await refreshSession(locale, since))) {
    return response;
  }
  await response.body?.cancel();

  return fetch(input, credentialed);
};

function localeOf(init: RequestInit | undefined): Locale | undefined {
  const header = new Headers(init?.headers).get("x-locale");

  return header === null ? undefined : (header as Locale);
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
