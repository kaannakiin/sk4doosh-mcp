import { asciiLower } from "../platform/ascii.js";
import type { BackendResponse } from "@sk-mcp/core";

export class HostNotAllowed extends Error {
  constructor(readonly host: string) {
    super(`sk-mcp-openapi: host '${host}' is not on the allowlist.`);
    this.name = "HostNotAllowed";
  }
}

export class ResponseTooLarge extends Error {
  constructor(readonly limit: number) {
    super(`sk-mcp-openapi: the response exceeded ${String(limit)} bytes.`);
    this.name = "ResponseTooLarge";
  }
}

export interface OutboundRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
}

export type BoundedFetch = (
  request: OutboundRequest,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<BackendResponse>;

/**
 * Guard: hop-by-hop headers describe one connection, and `set-cookie` would hand the backend's
 * session to the agent; neither may reach the error mapper or a result.
 */
const droppedHeaders = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "trailer",
  "set-cookie",
]);

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (response.body === null) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ResponseTooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * The only network egress of this package.
 *
 * Guard: redirects are never followed. A followed redirect would carry the request — and its
 * credential — to whatever host a `Location` header names, which is exactly what the allowlist
 * exists to prevent; a 3xx is returned to the error mapper as it arrived. The body is read under a
 * byte cap, so a backend that streams without end cannot exhaust memory before the budget check.
 */
export function createBoundedFetch(
  allowedHosts: ReadonlySet<string>,
): BoundedFetch {
  return async (request, signal, maxBytes) => {
    if (!allowedHosts.has(asciiLower(request.url.host))) {
      throw new HostNotAllowed(request.url.host);
    }
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
      signal,
      ...(request.body === undefined
        ? {}
        : { body: new Uint8Array(request.body) }),
    });
    const bytes = await readCapped(response, maxBytes);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      if (!droppedHeaders.has(asciiLower(name))) {
        headers[asciiLower(name)] = value;
      }
    });
    const contentType = response.headers.get("content-type") ?? undefined;
    return {
      status: response.status,
      headers,
      ...(contentType === undefined ? {} : { contentType }),
      ...(bytes.byteLength === 0
        ? {}
        : { body: new TextDecoder().decode(bytes) }),
    };
  };
}
