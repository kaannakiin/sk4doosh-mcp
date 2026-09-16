import type { EndpointPolicy } from "@chat/contracts/integration/discovery";

import { guardedFollow } from "./guarded-http.ts";

export interface GuardedFetchPolicy {
  readonly endpoint: EndpointPolicy;
  readonly followRedirects: boolean;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

/**
 * The subset of `oauth4webapi`'s `CustomFetchOptions` this adapter reads.
 *
 * Guard: declared structurally rather than imported, because `oauth4webapi` may
 * only be imported from `oauth-client.ts`. The library's own option type is
 * assignable to this one, so the compiler still rejects a shape change.
 */
export interface OutboundRequest {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly signal?: AbortSignal;
}

export type GuardedFetch = (
  url: string,
  options: OutboundRequest,
) => Promise<Response>;

/** This platform refused the address the url resolved to. */
export class BlockedAddressError extends Error {}

/** The server could not be reached, or answered something unusable. */
export class TransportError extends Error {}

/**
 * Guard: 204 and 304 carry no body and the `Response` constructor throws when
 * one is supplied, which would surface as an adapter crash rather than as the
 * empty response the server actually sent.
 */
const BODILESS_STATUS = new Set([204, 304]);

function serialize(body: unknown): string | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  throw new TransportError("the request body is not a form or a string");
}

/**
 * Wraps the guarded transport in the shape `oauth4webapi` expects from `fetch`.
 *
 * Guard: this is the only thing ever handed to the library as `customFetch`.
 * Every library call falls back to the global `fetch` when the option is
 * missing, and that path resolves a name and opens the socket in one step —
 * the SSRF the guarded lookup exists to refuse, with no error to notice.
 *
 * Guard: a refused address and an unreachable server are thrown as distinct
 * errors. The library reports both as a failed request, and the caller records
 * them as different columns — collapsing them hides the control firing.
 *
 * @param policy address policy, redirect budget, deadline and body ceiling
 * @returns a fetch-shaped function bound to that policy
 */
export function guardedOauthFetch(policy: GuardedFetchPolicy): GuardedFetch {
  return async (url, options) => {
    const body = serialize(options.body);
    const headers =
      body === undefined
        ? options.headers
        : {
            ...options.headers,
            "content-length": String(Buffer.byteLength(body)),
          };

    const outcome = await guardedFollow(
      {
        url,
        method: options.method,
        headers,
        body,
        signal: options.signal,
        timeoutMs: policy.timeoutMs,
        maxBytes: policy.maxBytes,
        maxRedirects: policy.followRedirects ? 3 : 0,
      },
      policy.endpoint,
    );

    if (outcome.kind === "refused") {
      throw new BlockedAddressError(outcome.reason);
    }

    if (outcome.kind === "failed") {
      throw new TransportError(`the request to ${url} did not complete`);
    }

    const { response } = outcome;
    if (response.status < 200 || response.status > 599) {
      throw new TransportError(`${url} answered ${response.status}`);
    }

    try {
      return new Response(
        BODILESS_STATUS.has(response.status) ? null : response.body,
        { status: response.status, headers: response.headers },
      );
    } catch (cause) {
      throw new TransportError(`${url} answered headers that cannot be read`, {
        cause,
      });
    }
  };
}
