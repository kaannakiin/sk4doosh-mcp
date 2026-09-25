import type { JsonRpcConnection } from "./json-rpc.ts";
import type { AppServerNotification } from "./protocol.ts";

/**
 * Buffers a connection's notifications for one reader.
 *
 * Guard: subscribe before the request that causes the events. `turn/start`
 * answers after the turn has begun, and the first deltas can arrive ahead of
 * that answer; a subscription opened afterwards loses the head of the message.
 */
export class NotificationQueue {
  private readonly items: AppServerNotification[] = [];

  private waiting:
    ((value: AppServerNotification | undefined) => void) | undefined;

  private closed = false;

  private readonly detach: (() => void)[] = [];

  constructor(connection: JsonRpcConnection, signal: AbortSignal) {
    this.detach.push(
      connection.subscribe((notification) => this.push(notification)),
      connection.onClose(() => this.close()),
    );
    signal.addEventListener("abort", () => this.close(), { once: true });
  }

  next(): Promise<AppServerNotification | undefined> {
    const item = this.items.shift();
    if (item !== undefined || this.closed) {
      return Promise.resolve(item);
    }

    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const detach of this.detach) {
      detach();
    }
    this.waiting?.(undefined);
    this.waiting = undefined;
  }

  private push(notification: AppServerNotification): void {
    if (this.closed) {
      return;
    }

    const waiting = this.waiting;
    if (waiting === undefined) {
      this.items.push(notification);

      return;
    }

    this.waiting = undefined;
    waiting(notification);
  }
}
