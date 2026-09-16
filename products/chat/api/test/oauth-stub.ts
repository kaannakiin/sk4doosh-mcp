import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

export interface StubReply {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface StubCall {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface Stub {
  readonly origin: string;
  readonly calls: readonly StubCall[];
  close(): Promise<void>;
}

export type StubHandler = (call: StubCall, origin: string) => StubReply;

export function json(value: unknown, status = 200): StubReply {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

/**
 * An authorization server this platform has not met, on loopback.
 *
 * The handler receives the origin because every url in the metadata it serves
 * has to name the port the operating system chose.
 */
export async function startStub(handler: StubHandler): Promise<Stub> {
  const calls: StubCall[] = [];
  let origin = "";

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const call: StubCall = {
        method: request.method ?? "GET",
        path: request.url ?? "/",
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [
            name,
            Array.isArray(value) ? value.join(", ") : (value ?? ""),
          ]),
        ),
        body: Buffer.concat(chunks).toString("utf8"),
      };
      calls.push(call);

      const reply = handler(call, origin);
      response.writeHead(reply.status, reply.headers ?? {});
      response.end(reply.body ?? "");
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    calls,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}
