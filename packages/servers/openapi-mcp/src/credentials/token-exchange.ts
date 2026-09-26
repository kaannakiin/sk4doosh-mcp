import { createHash } from "node:crypto";
import { SingleFlight } from "@liaiso/core";
import type { BoundedFetch } from "../net/fetch.js";
import type { TokenExchangeConfig } from "../platform/config.js";

export interface ExchangedToken {
  readonly token: string;
  /** Unix seconds. */
  readonly expiresAt: number;
}

export class TokenExchangeFailed extends Error {
  constructor(
    readonly rejected: boolean,
    message: string,
  ) {
    super(message);
    this.name = "TokenExchangeFailed";
  }
}

export interface TokenExchange {
  exchange(subjectToken: string): Promise<ExchangedToken>;
}

const skewSeconds = 30;

const maxTokenResponseBytes = 64 * 1024;

function subjectExpiry(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) {
    return undefined;
  }
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * RFC 8693 token exchange against one authorization server.
 *
 * Guard: the cache key is a digest of the subject token, never the token, so a heap dump of the
 * cache does not hold a usable credential; an exchanged token never outlives the subject token it
 * was issued for; a failure is not cached, so a caller whose grant is restored is not locked out
 * until an expiry; the token endpoint's body is never surfaced, for the reason a backend's 401 body
 * is not — it describes the credential, not the call.
 */
export function createTokenExchange(
  config: TokenExchangeConfig,
  clientSecret: string,
  fetcher: BoundedFetch,
  timeoutMs: number,
  now: () => number = () => Math.floor(Date.now() / 1000),
): TokenExchange {
  const cache = new Map<string, ExchangedToken>();
  const flight = new SingleFlight<string, ExchangedToken>();
  const endpoint = new URL(config.tokenEndpoint);

  async function request(subjectToken: string): Promise<ExchangedToken> {
    const form = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: subjectToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    });
    if (config.audience !== undefined) {
      form.set("audience", config.audience);
    }
    if (config.resource !== undefined) {
      form.set("resource", config.resource);
    }
    if (config.scope !== undefined) {
      form.set("scope", config.scope);
    }
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };
    if (config.clientAuth === "basic") {
      headers["authorization"] =
        `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(clientSecret)}`, "utf8").toString("base64")}`;
    } else {
      form.set("client_id", config.clientId);
      form.set("client_secret", clientSecret);
    }
    const response = await fetcher(
      {
        method: "POST",
        url: endpoint,
        headers,
        body: new TextEncoder().encode(form.toString()),
      },
      AbortSignal.timeout(timeoutMs),
      maxTokenResponseBytes,
    );
    if (response.status >= 500) {
      throw new TokenExchangeFailed(
        false,
        `The authorization server answered ${String(response.status)} to the token exchange.`,
      );
    }
    let body: { access_token?: unknown; expires_in?: unknown } = {};
    try {
      body = JSON.parse(response.body ?? "{}") as typeof body;
    } catch {
      body = {};
    }
    if (response.status !== 200 || typeof body.access_token !== "string") {
      throw new TokenExchangeFailed(
        true,
        "The authorization server refused to exchange the token.",
      );
    }
    const issuedFor =
      typeof body.expires_in === "number"
        ? now() + body.expires_in
        : now() + 300;
    const subjectExp = subjectExpiry(subjectToken);
    return {
      token: body.access_token,
      expiresAt:
        subjectExp === undefined ? issuedFor : Math.min(issuedFor, subjectExp),
    };
  }

  return {
    async exchange(subjectToken) {
      const key = createHash("sha256")
        .update(subjectToken)
        .update("\0")
        .update(config.audience ?? "")
        .update("\0")
        .update(config.resource ?? "")
        .update("\0")
        .update(config.scope ?? "")
        .digest("hex");
      const cached = cache.get(key);
      if (cached !== undefined && cached.expiresAt - skewSeconds > now()) {
        return cached;
      }
      cache.delete(key);
      const issued = await flight.run(key, () => request(subjectToken));
      cache.set(key, issued);
      return issued;
    },
  };
}
