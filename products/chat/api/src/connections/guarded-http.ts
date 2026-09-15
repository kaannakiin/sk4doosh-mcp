import {
  isLoopbackHost,
  isPrivateAddress,
} from "@chat/contracts/common/network-address";
import type { EndpointPolicy } from "@chat/contracts/integration/discovery";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

export interface GuardedRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export interface GuardedResponse {
  readonly status: number;
  readonly location: string | undefined;
  readonly challenge: string | undefined;
  readonly body: string;
}

export type GuardedOutcome =
  | { readonly kind: "response"; readonly response: GuardedResponse }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed" };

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
 * Makes one request to a url this platform does not control.
 *
 * Guard: redirects are never followed here. `http.request` does not follow them
 * on its own, and the caller re-validates each hop instead, so a server that
 * passed every check cannot answer `302` to an address that would not have.
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
        signal: AbortSignal.timeout(options.timeoutMs),
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
              ? { kind: "failed" }
              : {
                  kind: "response",
                  response: {
                    status: res.statusCode ?? 0,
                    location: res.headers.location,
                    challenge: res.headers["www-authenticate"],
                    body,
                  },
                },
          );
        });
        res.on("error", () => finish({ kind: "failed" }));
      },
    );

    req.on("error", (cause) => {
      finish(
        cause instanceof RefusedAddressError
          ? { kind: "refused", reason: cause.message }
          : { kind: "failed" },
      );
    });
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}
