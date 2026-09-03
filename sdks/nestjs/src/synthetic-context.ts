import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { DispatchResult } from "./dispatcher.js";

export interface SyntheticContext {
  req: IncomingMessage;
  res: ServerResponse;
  result: Promise<DispatchResult>;
}

function captureHeaders(res: ServerResponse): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.getHeaders())) {
    if (value === undefined) {
      continue;
    }
    headers[name.toLowerCase()] = Array.isArray(value)
      ? value.join(", ")
      : String(value);
  }
  return headers;
}

export function createSyntheticContext(
  method: string,
  url: string,
  headers: Record<string, string>,
  scheme: string,
  body?: Buffer,
): SyntheticContext {
  const socket = new Socket();
  if (scheme === "https") {
    Object.defineProperty(socket, "encrypted", { value: true });
  }

  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = url;
  req.headers = { ...headers };
  if (body !== undefined) {
    req.headers["content-length"] = String(body.byteLength);
    req.push(body);
  }
  req.push(null);

  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  const result = new Promise<DispatchResult>((resolve) => {
    const capture = (chunk: unknown, encoding: unknown): void => {
      if (typeof chunk === "string") {
        chunks.push(
          Buffer.from(
            chunk,
            typeof encoding === "string"
              ? (encoding as BufferEncoding)
              : "utf8",
          ),
        );
      } else if (chunk instanceof Buffer || chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      }
    };
    res.write = function write(
      chunk: unknown,
      encoding?: unknown,
      callback?: unknown,
    ): boolean {
      capture(chunk, encoding);
      const done = typeof encoding === "function" ? encoding : callback;
      if (typeof done === "function") {
        (done as () => void)();
      }
      return true;
    } as typeof res.write;
    res.end = function end(
      chunk?: unknown,
      encoding?: unknown,
      callback?: unknown,
    ): ServerResponse {
      if (typeof chunk !== "function") {
        capture(chunk, encoding);
      }
      const done = [chunk, encoding, callback].find(
        (arg) => typeof arg === "function",
      );
      const responseHeaders = captureHeaders(res);
      resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
        contentType: responseHeaders["content-type"],
        headers: responseHeaders,
      });
      res.emit("finish");
      res.emit("close");
      if (typeof done === "function") {
        (done as () => void)();
      }
      return res;
    } as typeof res.end;
  });

  return { req, res, result };
}
