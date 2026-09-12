import type { Locale } from "@chat/contracts/common/locale";
import type { ApiError } from "@chat/contracts/http/error";

/**
 * A contract schema, named by its shape rather than by `ZodType`.
 *
 * Guard: this package never names zod, as a value or as a type. It is a schema
 * consumer, so `@sk-mcp/eslint-config/chat`'s `chatApp` rule forbids the value
 * import, and a structural parse signature additionally keeps the declaration
 * self contained — a React Native consumer resolves `@chat/queries` without
 * pulling a second zod copy into its module graph.
 */
export interface ContractSchema<TOutput> {
  parse(input: unknown): TOutput;
}

export interface ChatRequestInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  locale: Locale;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * The transport every query in this package runs through.
 *
 * Guard: the platform supplies this, and nothing here reads `fetch`, a base url
 * or `import.meta.env`. Metro defines no `import.meta.env`, and the browser
 * carries the owner identity in an httpOnly cookie a native client has no jar
 * for — so the base url, the credentials mode and the auth headers differ per
 * platform and must stay injected.
 *
 * An implementation must reject with an error carrying an `ApiError` payload
 * (see `isChatClientError`); the not-found mapping in `sessions/detail` depends
 * on reading its `code`.
 */
export interface ChatClient {
  request<TOutput>(
    path: string,
    schema: ContractSchema<TOutput>,
    init: ChatRequestInit,
  ): Promise<TOutput>;
  requestNoContent(path: string, init: ChatRequestInit): Promise<void>;
  /** Absolute url for an api path, used as the AI SDK transport's `api`. */
  endpoint(path: string): string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
  authHeaders?(): Record<string, string>;
}

export interface ChatClientError extends Error {
  readonly payload: ApiError;
}

export function isChatClientError(error: unknown): error is ChatClientError {
  if (!(error instanceof Error) || !("payload" in error)) {
    return false;
  }

  const { payload } = error as { payload: unknown };

  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as ApiError).code === "string"
  );
}

export function errorCodeOf(error: unknown): string | undefined {
  return isChatClientError(error) ? error.payload.code : undefined;
}

/**
 * Whether the api answered "this session is not yours, or does not exist yet".
 *
 * Guard: the api answers 404 for both, deliberately — a 403 would confirm that
 * somebody else holds the id. A freshly minted session that has not survived a
 * turn yet is indistinguishable from a stranger's, and both open as an empty
 * conversation, so callers must treat this as a state rather than a failure.
 */
export function isSessionNotFound(error: unknown): boolean {
  return errorCodeOf(error) === "session_not_found";
}
