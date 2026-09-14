import { apiErrorSchema, type ApiError } from "@chat/contracts/http/error";

export class ApiRequestError extends Error {
  constructor(readonly payload: ApiError) {
    super(payload.message);
    this.name = "ApiRequestError";
  }
}

/**
 * Reads an api response into its body, or throws the error envelope it carries.
 *
 * @throws ApiRequestError when the api answers with an error
 */
export async function unwrap(response: Response): Promise<unknown> {
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

export function codeFor(status: number): string {
  return status >= 500 ? "internal_error" : "bad_request";
}
