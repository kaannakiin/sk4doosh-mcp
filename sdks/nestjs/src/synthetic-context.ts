import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

export interface SyntheticContext {
  req: IncomingMessage;
  res: ServerResponse;
  result: Promise<{ status: number; body: string }>;
}

export function createSyntheticContext(
  method: string,
  url: string,
  headers: Record<string, string>,
  scheme: string,
  body?: Buffer,
): SyntheticContext {
  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
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
  const result = new Promise<{ status: number; body: string }>((resolve) => {
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
      resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
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
