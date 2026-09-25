import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import {
  isKnownNotification,
  type AppServerMethod,
  type AppServerNotification,
  type ParamsOf,
  type ResultOf,
} from "./protocol.ts";

type NotificationListener = (notification: AppServerNotification) => void;

interface Pending {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
}

interface Envelope {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

const METHOD_NOT_FOUND = -32601;

export class AppServerError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | undefined,
    message: string,
  ) {
    super(`${method}: ${message}`);
  }
}

function parse(line: string): Envelope | undefined {
  try {
    const value: unknown = JSON.parse(line);

    return typeof value === "object" && value !== null
      ? (value as Envelope)
      : undefined;
  } catch {
    return undefined;
  }
}

export class JsonRpcConnection {
  private nextId = 1;

  private closed: Error | undefined;

  private readonly pending = new Map<number, Pending>();

  private readonly listeners = new Set<NotificationListener>();

  private readonly closers = new Set<(reason: Error) => void>();

  constructor(
    input: Readable,
    private readonly output: Writable,
  ) {
    createInterface({ input }).on("line", (line) => this.receive(line));
  }

  request<M extends AppServerMethod>(
    method: M,
    params: ParamsOf<M>,
  ): Promise<ResultOf<M>> {
    if (this.closed !== undefined) {
      return Promise.reject(this.closed);
    }

    const id = this.nextId++;

    return new Promise<ResultOf<M>>((resolve, reject) => {
      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: "initialized"): void {
    this.write({ jsonrpc: "2.0", method });
  }

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  onClose(listener: (reason: Error) => void): () => void {
    if (this.closed !== undefined) {
      listener(this.closed);

      return () => undefined;
    }
    this.closers.add(listener);

    return () => {
      this.closers.delete(listener);
    };
  }

  close(reason: Error): void {
    if (this.closed !== undefined) {
      return;
    }
    this.closed = reason;
    for (const pending of this.pending.values()) {
      pending.reject(reason);
    }
    this.pending.clear();
    this.listeners.clear();
    for (const closer of this.closers) {
      closer(reason);
    }
    this.closers.clear();
  }

  private receive(line: string): void {
    const message = parse(line);
    if (message === undefined) {
      return;
    }

    if (message.id !== undefined && message.method === undefined) {
      this.settle(message);

      return;
    }

    if (message.id !== undefined && message.method !== undefined) {
      this.refuse(message.id, message.method);

      return;
    }

    if (message.method !== undefined && isKnownNotification(message.method)) {
      const notification = {
        method: message.method,
        params: message.params,
      } as AppServerNotification;
      for (const listener of this.listeners) {
        listener(notification);
      }
    }
  }

  private settle(message: Envelope): void {
    const id = Number(message.id);
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return;
    }

    this.pending.delete(id);
    if (message.error === undefined) {
      pending.resolve(message.result);

      return;
    }

    pending.reject(
      new AppServerError(
        pending.method,
        message.error.code,
        message.error.message ?? "request failed",
      ),
    );
  }

  /**
   * Guard: a server request is answered, never left pending. Every turn runs
   * under `approvalPolicy: "never"` inside the sandbox, so no approval should be
   * asked; one that arrives anyway and goes unanswered holds the turn open until
   * its deadline instead of failing where the refusal can be read.
   */
  private refuse(id: number | string, method: string): void {
    this.write({
      jsonrpc: "2.0",
      id,
      error: {
        code: METHOD_NOT_FOUND,
        message: `${method} is not handled by this client`,
      },
    });
  }

  private write(message: object): void {
    this.output.write(`${JSON.stringify(message)}\n`);
  }
}
