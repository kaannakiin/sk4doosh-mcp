import {
  isLoopbackHost,
  isPrivateAddress,
} from "@chat/contracts/common/network-address";
import {
  isSecureEndpoint,
  type EndpointPolicy,
} from "@chat/contracts/integration/discovery";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

export interface GuardedRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

/**
 * Guard: `headers` is carried because `oauth4webapi` only checks
 * `content-type` on its error path — a DCR failure that comes back
 * `text/html` reads as unreachable instead of surfacing the server's `error`
 * body. Dropping headers here would make that unrecoverable downstream.
 */
export interface GuardedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * Guard: an answer refused for its size is reported apart from one that never
 * arrived. Collapsing the two tells a reader that a server did not respond when
 * in fact it responded with more than this platform agreed to read, and no
 * amount of retrying will change that.
 */
export type TransportFailure = "transport" | "oversized";

export type GuardedOutcome =
  | { readonly kind: "response"; readonly response: GuardedResponse }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: TransportFailure };

export interface GuardedFollow extends GuardedRequest {
  readonly maxRedirects: number;
}

export class RefusedAddressError extends Error {}

/**
 * Builds the resolver every socket for a registrant-supplied url goes through.
 *
 * Guard: the check runs inside the lookup rather than before the request, and
 * only addresses it accepted are handed back. There is no window between
 * deciding a name is safe and connecting to it, so a name that answers
 * differently on a second query — the ordinary rebinding move — never gets a
 * second query to answer.
 *
 * Guard: every answer is inspected, not the first. A name that returns one
 * public and one private address would otherwise be reachable through whichever
 * the connector happened to try, and dual-stack connectors try several.
 *
 * @param policy whether this caller accepts loopback
 * @returns a `lookup` for `http.request`, which passes it to `net.connect`
 */
export function publicOnlyLookup(policy: EndpointPolicy): LookupFunction {
  return ((hostname, options, callback): void => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error !== null) {
        callback(error, "", 0);

        return;
      }

      const answers = addresses as LookupAddress[];
      const refused = answers.find(
        ({ address }) =>
          isPrivateAddress(address) &&
          !(policy.allowLoopback && isLoopbackHost(address)),
      );

      const first = answers[0];
      if (refused !== undefined || first === undefined) {
        callback(
          new RefusedAddressError(
            `${hostname} resolves outside the public internet (${refused?.address ?? "no address"})`,
          ),
          "",
          0,
        );

        return;
      }

      if (options.all === true) {
        (callback as unknown as (e: null, a: LookupAddress[]) => void)(
          null,
          answers,
        );

        return;
      }

      callback(null, first.address, first.family);
    });
  }) as LookupFunction;
}

/**
 * Guard: `set-cookie` is dropped rather than folded. This platform holds no
 * session against a registrant-supplied server, so a cookie it sets has no
 * legitimate reader here — and carrying one into the response object hands it
 * to every later caller that sees the response.
 *
 * Guard: the record is built through a `Map` and `Object.fromEntries`, so a
 * header literally named `__proto__` becomes an own property instead of
 * reaching the object's prototype.
 */
function foldHeaders(raw: IncomingHttpHeaders): Record<string, string> {
  const folded = new Map<string, string>();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined || name === "set-cookie") {
      continue;
    }

    folded.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  return Object.fromEntries(folded);
}

/**
 * Makes one request to a url this platform does not control.
 *
 * Guard: redirects are never followed here. `http.request` does not follow them
 * on its own, and `guardedFollow` re-validates each hop instead, so a server
 * that passed every check cannot answer `302` to an address that would not have.
 *
 * Guard: a refusal is reported apart from a failure. Both end the request, but
 * one is this platform blocking an address and the other is a server being
 * down, and an operator who cannot tell them apart cannot see the control fire.
 *
 * @param options the request, its deadline and the ceiling on the body it reads
 * @param policy whether loopback is reachable for this caller
 * @returns the response, the address refusal, or a plain failure
 */
export async function guardedRequest(
  options: GuardedRequest,
  policy: EndpointPolicy,
): Promise<GuardedOutcome> {
  const url = new URL(options.url);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const deadline = AbortSignal.timeout(options.timeoutMs);
  const signal =
    options.signal === undefined
      ? deadline
      : AbortSignal.any([deadline, options.signal]);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: GuardedOutcome): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const req = send(
      url,
      {
        method: options.method ?? "GET",
        headers: options.headers,
        lookup: publicOnlyLookup(policy),
        signal,
      },
      (res) => {
        let body = "";
        let overran = false;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (body.length + chunk.length > options.maxBytes) {
            overran = true;
            res.destroy();

            return;
          }
          body += chunk;
        });
        res.on("end", () => {
          finish(
            overran
              ? { kind: "failed", reason: "oversized" }
              : {
                  kind: "response",
                  response: {
                    status: res.statusCode ?? 0,
                    headers: foldHeaders(res.headers),
                    body,
                  },
                },
          );
        });
        res.on("close", () => {
          if (overran) {
            finish({ kind: "failed", reason: "oversized" });
          }
        });
        res.on("error", () =>
          finish({
            kind: "failed",
            reason: overran ? "oversized" : "transport",
          }),
        );
      },
    );

    req.on("error", (cause) => {
      finish(
        cause instanceof RefusedAddressError
          ? { kind: "refused", reason: cause.message }
          : { kind: "failed", reason: "transport" },
      );
    });
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Makes a request and follows up to `maxRedirects` hops.
 *
 * Guard: each hop is re-validated rather than followed. A server that passed
 * every check on its own address would otherwise answer `302` to one that would
 * not have, and the platform would follow it without another word.
 *
 * Guard: the hop budget is the caller's, and a request carrying a credential
 * passes zero. A redirected `POST` to a token or registration endpoint replays
 * the client secret to whatever host the response named.
 *
 * @param options the request plus how many hops this caller permits
 * @param policy whether loopback is reachable for this caller
 * @returns the final response, the address refusal, or a plain failure
 */
export async function guardedFollow(
  options: GuardedFollow,
  policy: EndpointPolicy,
): Promise<GuardedOutcome> {
  let target = options.url;
  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    if (!isSecureEndpoint(target, policy)) {
      return {
        kind: "refused",
        reason: `${target} is not an endpoint this platform will request`,
      };
    }

    const outcome = await guardedRequest({ ...options, url: target }, policy);
    if (outcome.kind !== "response") {
      return outcome;
    }

    const { response } = outcome;
    const location = response.headers["location"];
    if (
      response.status < 300 ||
      response.status >= 400 ||
      location === undefined
    ) {
      return outcome;
    }

    try {
      target = new URL(location, target).href;
    } catch {
      return { kind: "failed", reason: "transport" };
    }
  }

  return { kind: "failed", reason: "transport" };
}
