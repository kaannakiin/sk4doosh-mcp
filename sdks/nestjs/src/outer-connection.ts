import { AsyncLocalStorage } from "node:async_hooks";

export interface OuterConnection {
  readonly remoteAddress?: string;
  readonly remotePort?: number;
  readonly localAddress?: string;
  readonly localPort?: number;
}

interface SocketLike {
  readonly remoteAddress?: string;
  readonly remotePort?: number;
  readonly localAddress?: string;
  readonly localPort?: number;
}

const storage = new AsyncLocalStorage<OuterConnection>();

export function connectionOf(
  source: { readonly socket?: SocketLike } | undefined,
): OuterConnection | undefined {
  const socket = source?.socket;
  if (socket === undefined) {
    return undefined;
  }
  const connection: OuterConnection = {
    remoteAddress: socket.remoteAddress,
    remotePort: socket.remotePort,
    localAddress: socket.localAddress,
    localPort: socket.localPort,
  };
  return Object.values(connection).some((value) => value !== undefined)
    ? connection
    : undefined;
}

export function runWithOuterConnection<T>(
  connection: OuterConnection | undefined,
  fn: () => T,
): T {
  return connection === undefined ? fn() : storage.run(connection, fn);
}

export function currentOuterConnection(): OuterConnection | undefined {
  return storage.getStore();
}
